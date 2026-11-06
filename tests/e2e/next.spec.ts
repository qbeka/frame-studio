import { expect, test } from '@playwright/test';

const URL = 'http://localhost:5183/';

test('server renders the initial state, then hydrates with no errors', async ({ page, request }) => {
  const html = await (await request.get(URL)).text();
  expect(html).toContain('Corner Bakery');
  expect(html).toContain('data-frame-root');
  // The form is in the server HTML, hidden, because the first state hides it.
  expect(html).toMatch(/<form[^>]*hidden/);

  const problems: string[] = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(URL);
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await expect(page.getByLabel('Merchant')).toBeFocused();
  expect(problems).toEqual([]);
});

test('the full interaction works in a Next.js production build', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.getByLabel('Amount').fill('nope');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.fx-error')).toBeVisible();
  await page.getByLabel('Amount').fill('9.99');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Amount')).toHaveValue('9.99');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit expense' })).toBeFocused();
});
