import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openFresh, recordReversal, STUDIO } from './helpers';

const CONSUMER = 'http://localhost:5182/';

// Automated checks catch only part of accessibility. A clean run here is not a full audit.
async function axe(page: import('@playwright/test').Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('automated checks: studio at rest', async ({ page }) => {
  await openFresh(page);
  expect(await axe(page)).toEqual([]);
});

test('automated checks: studio while inspecting', async ({ page }) => {
  await openFresh(page);
  await recordReversal(page);
  expect(await axe(page)).toEqual([]);
});

test('automated checks: export dialog', async ({ page }) => {
  await openFresh(page);
  await page.getByRole('button', { name: 'Export' }).click();
  expect(await axe(page)).toEqual([]);
});

test('automated checks: exported component in each state', async ({ page }) => {
  await page.goto(CONSUMER);
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.waitForTimeout(800);
  expect(await axe(page)).toEqual([]);
});

test('the whole authoring path works by keyboard alone', async ({ page }) => {
  await openFresh(page);
  // Reach the component's button by tabbing, with no pointer anywhere in this test.
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.textContent)) === 'Edit expense') break;
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(90);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Pause', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.mode')).toHaveText('Inspecting');
  await page.getByRole('slider', { name: 'Playhead' }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('PageUp');
  await expect(page.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuenow', '100');
  // The state list reaches what the pointer only graph reaches.
  await page.getByRole('button', { name: /Editing to Confirmation/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.properties h2').first()).toHaveText('Editing to Confirmation');
});

test('every icon-free control has a name, and focus is drawn', async ({ page }) => {
  await openFresh(page);
  const unnamed = await page.locator('button, select, input:not([hidden]), [role=slider]').evaluateAll((els) =>
    els.filter((e) => !(e as HTMLElement).closest('[inert]') && !(e.getAttribute('aria-label') || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).map((e) => e.outerHTML),
  );
  expect(unnamed).toEqual([]);
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).toBe('solid');
});

test('the export works by touch on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(CONSUMER);
  await page.getByRole('button', { name: 'Edit expense' }).tap();
  await expect(page.getByLabel('Merchant')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await expect(page.getByRole('button', { name: 'Edit expense' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

for (const width of [320, 390]) {
  test(`the export fits at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(CONSUMER);
    await page.getByRole('button', { name: 'Edit expense' }).click();
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('at 200 percent zoom the studio keeps its task usable', async ({ page }) => {
  // 200% zoom on a 1440 by 900 window lays out as 720 by 450 CSS pixels.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(STUDIO);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.stage-live').getByRole('button', { name: 'Edit expense' })).toBeVisible();
  await recordReversal(page);
  await expect(page.locator('.ribbon')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('long content grows the panel without breaking the layout', async ({ page }) => {
  await page.goto(CONSUMER);
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.getByLabel('Merchant').fill('The Very Long Merchant Name That Keeps Going Past Any Reasonable Width Of This Panel Ltd');
  await page.waitForTimeout(300);
  const fits = await page.evaluate(() => {
    const root = document.querySelector('[data-frame-root]')!.getBoundingClientRect();
    const title = document.querySelector('.fx-merchant')!.getBoundingClientRect();
    return title.right <= root.right + 0.5;
  });
  expect(fits).toBe(true);
});

test('removing a target in flight does not throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(CONSUMER);
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.evaluate(() => document.querySelector('[data-frame-target=summary]')!.remove());
  await page.waitForTimeout(600);
  expect(errors).toEqual([]);
});

test('an exit stays in place under a positioned wrapper', async ({ page }) => {
  await page.goto(CONSUMER);
  await page.addStyleTag({ content: '.fx-content { position: relative; top: 0; margin-top: 30px; }' });
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.waitForTimeout(800);
  const form = page.locator('[data-frame-target=form]');
  const before = (await form.boundingBox())!.y;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toHaveAttribute('data-frame-exiting', '');
  const after = (await form.boundingBox())!.y;
  // One frame into the exit, it must not have jumped by the wrapper's offset.
  expect(Math.abs(after - before)).toBeLessThan(10);
});

test('page scrolling during a transition changes nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 300 });
  await page.goto(CONSUMER);
  await page.evaluate(() => (document.body.style.minHeight = '3000px'));
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.evaluate(() => window.scrollTo(0, 180));
  await page.waitForTimeout(900);
  const offset = await page.evaluate(() => {
    const root = document.querySelector('[data-frame-root]')!.getBoundingClientRect();
    const surface = document.querySelector('[data-frame-target=surface]')!.getBoundingClientRect();
    return Math.abs(root.top - surface.top) + Math.abs(root.height - surface.height);
  });
  expect(offset).toBeLessThan(0.01);
});
