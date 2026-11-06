import { expect, test } from '@playwright/test';

const URL = 'http://localhost:5182/';

/** Height of the drawn surface right now. */
const surfaceHeight = (page: import('@playwright/test').Page) =>
  page.locator('[data-frame-target=surface]').evaluate((el) => el.getBoundingClientRect().height);

test.describe('exported inspector in a clean Vite app', () => {
  test('opens, keeps typed text, shows a validation error, saves and finishes', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    await expect(page.getByLabel('Merchant')).toBeFocused();

    await page.getByLabel('Amount').fill('nope');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('above zero');
    await expect(page.getByLabel('Amount')).toHaveValue('nope');

    await page.getByLabel('Amount').fill('24.10');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('Saving this expense');
    await expect(page.getByRole('status')).toHaveText('Saved to your ledger', { timeout: 4000 });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Edit expense' })).toBeFocused();
    await expect(page.getByText('$24.10')).toBeVisible();
  });

  test('reversing while a save is pending returns to editing with the text intact', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    await page.getByLabel('Note').fill('Reversed mid save');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('Note')).toHaveValue('Reversed mid save');
    await expect(page.getByLabel('Note')).toBeVisible();
    // Focus moved out of the receipt, which is now gone, into the form.
    await expect(page.getByLabel('Merchant')).toBeFocused();
    await expect(page.locator('[data-frame-exiting]')).toHaveCount(0, { timeout: 2000 });
  });

  test('typing continues through a reversal without losing focus', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    await page.keyboard.type('X');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Edit expense' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Merchant')).toBeFocused();
    await expect(page.getByLabel('Merchant')).toHaveValue(/X/);
  });

  test('reversal is continuous in the real browser', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    const heights = await page.evaluate(async () => {
      const surface = document.querySelector('[data-frame-target=surface]')!;
      const seen: number[] = [];
      const start = performance.now();
      let cancelled = false;
      await new Promise<void>((resolve) => {
        const loop = () => {
          seen.push(surface.getBoundingClientRect().height);
          if (!cancelled && performance.now() - start > 90) {
            cancelled = true;
            (document.querySelector('.fx-actions button') as HTMLButtonElement).click();
          }
          if (performance.now() - start < 800) requestAnimationFrame(loop);
          else resolve();
        };
        requestAnimationFrame(loop);
      });
      return seen;
    });
    const jumps = heights.slice(1).map((h, i) => Math.abs(h - heights[i]!));
    expect(Math.max(...jumps)).toBeLessThan(40);
    expect(await surfaceHeight(page)).toBeLessThan(130);
  });

  test('reduced motion reaches the same states with no travel', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(URL);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    const first = await surfaceHeight(page);
    await page.waitForTimeout(300);
    expect(Math.abs((await surfaceHeight(page)) - first)).toBeLessThan(0.01);
    await expect(page.getByLabel('Merchant')).toBeFocused();
  });

  test('leaves no inline styles once settled', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    await page.waitForTimeout(900);
    const styles = await page.locator('[data-frame-target]:not([hidden])').evaluateAll((els) => els.map((e) => e.getAttribute('style') ?? ''));
    expect(styles.join('')).toBe('');
  });
});
