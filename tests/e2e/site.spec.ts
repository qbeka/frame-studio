import { expect, test, type Page } from '@playwright/test';

const SITE = 'http://localhost:5184/';

const surface = (page: Page) => page.locator('.stage-live [data-frame-target=surface]');
const drawnHeight = (page: Page) => surface(page).evaluate((el) => el.getBoundingClientRect().height);
const shownHeight = async (page: Page) => Number.parseFloat((await page.locator('#read-height').textContent())!);

async function seek(page: Page, ms: number) {
  await page.locator('#time').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, ms);
  await expect(page.locator('#clock')).toHaveText(`${ms} ms`);
}

test.beforeEach(async ({ page }) => {
  await page.goto(SITE);
  await expect(page.locator('svg.chart')).toBeVisible();
});

test('draws the real component at the height the runtime reports', async ({ page }) => {
  for (const ms of [120, 250, 400]) {
    await seek(page, ms);
    expect(Math.abs((await drawnHeight(page)) - (await shownHeight(page)))).toBeLessThan(0.05);
  }
});

test('each interruption rule changes the outcome', async ({ page }) => {
  const atEnd = async () => {
    const max = Number(await page.locator('#time').getAttribute('max'));
    await seek(page, max);
    return { state: await page.locator('#read-state').textContent(), height: await drawnHeight(page) };
  };
  const reversed = await atEnd();
  expect(reversed.state).toBe('Compact');

  await page.getByRole('button', { name: 'Ignore it' }).click();
  const ignored = await atEnd();
  expect(ignored.state).toBe('Editing');
  expect(ignored.height).toBeGreaterThan(reversed.height);

  await page.getByRole('button', { name: 'Finish first' }).click();
  const queued = await atEnd();
  expect(queued.state).toBe('Compact');
  await seek(page, 300);
  expect(await page.locator('#read-state').textContent()).toBe('Editing');
});

test('the rule changes the same moment of the same take', async ({ page }) => {
  await seek(page, 320);
  const reversed = await drawnHeight(page);
  await page.getByRole('button', { name: 'Ignore it' }).click();
  await expect(page.locator('#read-state')).toHaveText('Editing');
  expect(await drawnHeight(page)).toBeGreaterThan(reversed + 10);
});

test('moves the interruption from the keyboard', async ({ page }) => {
  const settle = page.locator('#read-settle');
  const before = await settle.textContent();
  const marker = page.getByRole('slider', { name: 'When Cancel lands' });
  await marker.focus();
  await page.keyboard.press('End');
  await expect(marker).toHaveAttribute('aria-valuenow', '320');
  await expect(settle).not.toHaveText(before!);
});

test('plays through and stops at the end', async ({ page }) => {
  await page.locator('#speed').click();
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play', { timeout: 10_000 });
  const max = await page.locator('#time').getAttribute('max');
  await expect(page.locator('#clock')).toHaveText(`${max} ms`);
});

test('the hero button brings the replay into view and plays it', async ({ page }) => {
  await page.locator('#hero-play').click();
  await expect(page.locator('#play')).toHaveText('Pause');
  await expect.poll(() => page.locator('#clock').textContent().then((text) => Number.parseFloat(text!))).toBeGreaterThan(20);
  await expect(page.locator('#replay-title')).toBeInViewport();
});

test('leaves input off during replay, with no sideways scroll on a phone', async ({ page }) => {
  await expect(page.locator('.stage-live')).toHaveAttribute('inert', '');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect.poll(async () => {
    const panel = await surface(page).boundingBox();
    const stage = await page.locator('.stage').boundingBox();
    return panel!.x + panel!.width <= stage!.x + stage!.width - 8;
  }).toBe(true);
});
