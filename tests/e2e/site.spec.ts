import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** SITE_URL points these at a production build served under the site's own path and headers. */
const SITE = process.env.SITE_URL ?? 'http://localhost:5184/';

const surface = (page: Page) => page.locator('.live [data-frame-target=surface]');
const drawnHeight = (page: Page) => surface(page).evaluate((el) => el.getBoundingClientRect().height);
const clockMs = async (page: Page) => Number.parseInt((await page.locator('#clock').textContent())!, 10);
const editExpense = (page: Page) => page.locator('.live').getByRole('button', { name: 'Edit expense' });
const openButton = (page: Page) => page.locator('#open');
const cancelButton = (page: Page) => page.locator('#cancel');
const replayButton = (page: Page) => page.locator('#replay');
const marker = (page: Page) => page.getByRole('slider', { name: 'When Cancel lands' });
const curvePath = (page: Page) => page.locator('.line-take').getAttribute('d');

/** The panel's height on every frame until the page says stop, for checking continuity. */
async function recordHeights(page: Page) {
  await page.evaluate(() => {
    const element = document.querySelector('.live [data-frame-target=surface]')!;
    const log: number[] = [];
    (window as unknown as { __heights: number[] }).__heights = log;
    (function step() {
      log.push(element.getBoundingClientRect().height);
      if (log.length < 600) requestAnimationFrame(step);
    })();
  });
}

async function waitForStill(page: Page) {
  await expect.poll(async () => {
    const before = await drawnHeight(page);
    await page.waitForTimeout(60);
    return Math.abs((await drawnHeight(page)) - before);
  }).toBeLessThan(0.01);
}

test.describe('with the example already seen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SITE);
    await expect(page.locator('.line-take')).toBeVisible();
    // Any press stops the example waiting to play, so every test starts from rest.
    await page.locator('#take-note').click();
    await waitForStill(page);
  });

  test('the button inside the showcase works', async ({ page }) => {
    const closed = await drawnHeight(page);
    await expect(page.locator('.live')).not.toHaveAttribute('inert');
    await editExpense(page).click();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect.poll(() => drawnHeight(page)).toBeGreaterThan(closed + 100);
    await expect(page.getByRole('textbox', { name: 'Merchant' }).first()).toBeFocused();
    await page.keyboard.type(' & Co');
    await expect(page.locator('.live .fx-merchant')).toHaveText('Corner Bakery & Co');
    await page.locator('.live').getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => drawnHeight(page)).toBeLessThan(closed + 5);
  });

  test('runs at normal speed by default, and slow motion also slows the live panel', async ({ page }) => {
    await expect(page.locator('#slow')).toHaveAttribute('aria-pressed', 'false');
    const started = Date.now();
    await openButton(page).click();
    await expect.poll(() => drawnHeight(page), { intervals: [20] }).toBeGreaterThan(250);
    await waitForStill(page);
    expect(Date.now() - started).toBeLessThan(1_500);

    await cancelButton(page).click();
    await waitForStill(page);
    await page.locator('#slow').click();
    await expect(page.locator('#slow')).toHaveAttribute('aria-pressed', 'true');
    await openButton(page).click();
    await page.waitForTimeout(600);
    const clock = await clockMs(page);
    expect(clock).toBeGreaterThan(100);
    expect(clock).toBeLessThan(320);
  });

  test('cancelling halfway continues from the interruption, and the line forks', async ({ page }) => {
    await page.locator('#slow').click();
    const closed = await drawnHeight(page);
    await recordHeights(page);
    await openButton(page).click();
    await page.waitForTimeout(500);
    const halfway = await drawnHeight(page);
    expect(halfway).toBeGreaterThan(closed + 5);
    await cancelButton(page).click();
    await expect(marker(page)).toBeVisible();
    await expect(page.locator('.line-ghost')).toHaveCount(1);
    await expect(page.locator('#take-note')).toContainText('took over from the current height and speed');
    await expect.poll(() => drawnHeight(page), { timeout: 5_000 }).toBeLessThan(closed + 1);
    const heights = await page.evaluate(() => (window as unknown as { __heights: number[] }).__heights);
    const steps = heights.slice(1).map((value, i) => Math.abs(value - heights[i]!));
    // Slow motion at a frame or two per step. A jump at the reversal would be far bigger.
    expect(Math.max(...steps)).toBeLessThan(40);
    expect(Math.max(...heights)).toBeLessThan(closed + 250);
  });

  test('the whole component works, and the stage box holds still', async ({ page }) => {
    const stage = page.locator('#stage');
    const box = (await stage.boundingBox())!;
    const expectSameBox = async () => {
      const now = (await stage.boundingBox())!;
      expect(now.height).toBe(box.height);
      expect(now.width).toBe(box.width);
    };
    const panel = page.locator('.live');
    await editExpense(page).click();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expectSameBox();

    await panel.getByRole('textbox', { name: 'Amount' }).fill('0');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Enter an amount above zero, such as 18.40.');
    await expectSameBox();

    await panel.getByRole('textbox', { name: 'Amount' }).fill('24.10');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('button', { name: 'Keep editing' })).toBeVisible();
    await expect(panel.locator('.fx-amount')).toHaveText('$24.10');
    await panel.getByRole('button', { name: 'Keep editing' }).click();
    await expect(panel.getByRole('button', { name: 'Save' })).toBeVisible();
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 4_000 });
    await expect(openButton(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(cancelButton(page)).toHaveAttribute('aria-disabled', 'true');
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(editExpense(page)).toBeVisible();
    await expect(openButton(page)).not.toHaveAttribute('aria-disabled', 'true');

    await page.getByRole('button', { name: 'Inspect' }).click();
    await expectSameBox();
    await page.locator('#export').click();
    await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
    await expectSameBox();
  });

  test('Finish first holds a live Cancel until Open has settled', async ({ page }) => {
    await page.getByRole('button', { name: 'Finish first' }).click();
    await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
    await page.locator('#slow').click();
    const closed = await drawnHeight(page);
    await openButton(page).click();
    await page.waitForTimeout(240);
    await cancelButton(page).click();
    await expect(page.locator('#take-note')).toContainText('waited for the motion to finish');
    await expect.poll(() => drawnHeight(page), { timeout: 5_000 }).toBeGreaterThan(closed + 150);
    await expect.poll(() => drawnHeight(page), { timeout: 6_000 }).toBeLessThan(closed + 1);
    await expect(openButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Export can be closed mid replay, and reopens on the latest motion', async ({ page }) => {
    await page.locator('#export').click();
    await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
    await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
    await page.getByRole('button', { name: 'Close export' }).click();
    await page.getByRole('button', { name: 'Lively' }).click();
    await expect(page.getByRole('button', { name: 'Lively' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#export').click();
    await page.getByRole('button', { name: 'Code' }).click();
    await expect(page.locator('.code pre')).toContainText('"stiffness": 520');
    await expect(page.locator('.code pre')).toContainText('"damping": 20');
  });

  test('pressing Cancel too late says so', async ({ page }) => {
    await openButton(page).click();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(1_000);
    await expect(page.locator('#take-note')).toContainText('Open ran to the end');
    await cancelButton(page).click();
    await expect(page.locator('#take-note')).toContainText('nothing to interrupt');
  });

  test('the interruption moves along the timeline, by pointer and keyboard', async ({ page }) => {
    const before = await curvePath(page);
    const handle = marker(page);
    await expect(handle).toHaveAttribute('aria-valuenow', '150');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + 8, { steps: 4 });
    await page.mouse.up();
    const moved = Number(await handle.getAttribute('aria-valuenow'));
    expect(moved).toBeGreaterThan(190);
    expect(await curvePath(page)).not.toBe(before);

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(moved - 5));
    await expect(handle).toBeFocused();
    const held = await drawnHeight(page);
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await drawnHeight(page)).not.toBe(held);
  });

  test('each interruption rule changes the outcome of the same take', async ({ page }) => {
    await page.getByRole('button', { name: 'Ignore it' }).click();
    await expect(page.getByRole('button', { name: 'Ignore it' })).toHaveAttribute('aria-pressed', 'true');
    await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    const ignored = await drawnHeight(page);

    await page.getByRole('button', { name: 'Finish first' }).click();
    await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
    await expect(openButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    expect(await drawnHeight(page)).toBeLessThan(ignored - 50);
  });

  test('replay plays through and stops, and Pause holds it', async ({ page }) => {
    await page.locator('#slow').click();
    await replayButton(page).click();
    await expect(replayButton(page).locator('.on')).toHaveText('Pause');
    await page.waitForTimeout(400);
    await replayButton(page).click();
    const held = await clockMs(page);
    expect(held).toBeGreaterThan(0);
    await page.waitForTimeout(150);
    expect(await clockMs(page)).toBe(held);
    await page.locator('#slow').click();
    await replayButton(page).click();
    await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
    expect(await clockMs(page)).toBeGreaterThan(held);
  });

  test('replay waits until the panel is in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 320 });
    await page.evaluate(() => {
      const top = document.querySelector('.transport')!.getBoundingClientRect().top + scrollY;
      scrollTo({ top: top - 10, behavior: 'instant' });
    });
    const panelBox = () => page.locator('.canvas').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(await panelBox()).toBeLessThan(40);
    await replayButton(page).dispatchEvent('click');
    // The take may only start moving once the page has stopped.
    await page.evaluate(() => {
      const log: { scroll: number; playing: boolean }[] = [];
      (window as unknown as { __log: unknown }).__log = log;
      (function step() {
        log.push({ scroll: scrollY, playing: document.querySelector('#replay .on')!.textContent === 'Pause' });
        if (log.length < 240) requestAnimationFrame(step);
      })();
    });
    await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
    const log = await page.evaluate(() => (window as unknown as { __log: { scroll: number; playing: boolean }[] }).__log);
    const start = log.findIndex((row) => row.playing);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(log[start]!.scroll).toBe(log[Math.max(0, start - 1)]!.scroll);
    await expect.poll(panelBox).toBeGreaterThan(100);
  });

  test('anything pressed during a replay takes over from that moment', async ({ page }) => {
    await page.locator('#slow').click();
    await replayButton(page).click();
    await expect.poll(() => clockMs(page), { intervals: [20] }).toBeGreaterThan(30);
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    const during = await drawnHeight(page);
    await cancelButton(page).click();
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');
    expect(Math.abs((await drawnHeight(page)) - during)).toBeLessThan(40);
    await expect(page.locator('#take-note')).not.toContainText('example take');
    await expect(marker(page)).toBeVisible();
  });

  test('Inspect reveals the spring, per target timing and recorded commands', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Try it' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Reverse from here' })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect' }).click();
    await expect(page.getByRole('button', { name: 'Inspect' })).toHaveAttribute('aria-pressed', 'true');
    const stiffness = page.getByRole('slider', { name: 'Stiffness' });
    await expect(stiffness).toHaveValue('420');
    await expect(page.getByRole('slider', { name: 'Damping' })).toHaveValue('34');
    await expect(page.getByRole('slider', { name: 'Form fade' })).toHaveValue('180');
    await expect(page.locator('.commands li')).toHaveCount(2);
    await expect(page.locator('.commands li').nth(1)).toContainText('cancel');

    const before = await curvePath(page);
    await stiffness.focus();
    await page.keyboard.press('Home');
    await expect(stiffness).toHaveValue('60');
    expect(await curvePath(page)).not.toBe(before);
    await page.getByRole('button', { name: 'Reset motion' }).focus();
    await page.keyboard.press('Enter');
    await expect(stiffness).toHaveValue('420');
    expect(await curvePath(page)).toBe(before);
    await expect(page.getByRole('button', { name: 'Reset motion' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Reset motion' })).toBeFocused();
  });

  test('the exported preview reproduces the same take, and the download holds the edit', async ({ page }) => {
    await page.getByRole('button', { name: 'Soft' }).click();
    await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
    await page.locator('#export').click();
    const exported = page.locator('#exported [data-frame-target=surface]');
    await expect(exported).toBeVisible();
    await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
    await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });

    const seekHandle = page.getByRole('slider', { name: 'Time in the take' });
    await seekHandle.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+ArrowRight');
      const [a, b] = await Promise.all([drawnHeight(page), exported.evaluate((el) => el.getBoundingClientRect().height)]);
      expect(Math.abs(a - b)).toBeLessThan(0.01);
      await expect.poll(() => page.locator('#height-exported').textContent()).toBe(await page.locator('#height-ours').textContent());
    }

    await page.getByRole('button', { name: 'Code' }).click();
    await expect(page.locator('.code pre')).toContainText('"stiffness": 170');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('expense-panel-motion.zip');
    const zip = readFileSync(await download.path()).toString('latin1');
    expect(zip).toContain('expense-panel-motion/motion.config.ts');
    expect(zip).toContain('"stiffness": 170');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();
    await expect(page.locator('#export')).toBeFocused();
  });

  test('disabled controls keep focus and do nothing', async ({ page }) => {
    await expect(cancelButton(page)).toHaveAttribute('aria-disabled', 'true');
    await cancelButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(cancelButton(page)).toBeFocused();
    await expect(page.locator('#take-note')).toContainText('example take');
  });

  test('stays usable after a resize with the panel open', async ({ page }) => {
    await openButton(page).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await waitForStill(page);
    await page.locator('.live').getByRole('button', { name: 'Cancel' }).click();
    await expect(editExpense(page)).toBeVisible();
    const stage = (await page.locator('.canvas').boundingBox())!;
    const panel = (await surface(page).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(stage.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(stage.x + stage.width);
  });
});

test('passes automated accessibility checks in each mode', async ({ page }) => {
  await page.goto(SITE);
  await page.locator('#take-note').click();
  const violations = async () => (await new AxeBuilder({ page }).analyze()).violations.map((item) => `${item.id}: ${item.nodes[0]?.html}`);
  expect(await violations()).toEqual([]);
  // Colors are read once a control's short transition has ended.
  await page.getByRole('button', { name: 'Inspect' }).click();
  await page.waitForTimeout(250);
  expect(await violations()).toEqual([]);
  await page.locator('#export').click();
  await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
  await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
  await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
  await page.waitForTimeout(250);
  expect(await violations()).toEqual([]);
});

test('the example plays once on its own, only after the demo is in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${SITE}#details`);
  await expect(page.locator('.line-take')).toBeVisible();
  await page.waitForTimeout(1_200);
  await expect(replayButton(page).locator('.on')).toHaveText('Replay');
  const untouched = await clockMs(page);
  expect(untouched).toBeGreaterThan(400);

  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 3_000 });
  await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 3_000 });
});

test('a press before the example starts cancels it', async ({ page }) => {
  await page.goto(SITE);
  await editExpense(page).click();
  await page.waitForTimeout(1_000);
  await expect(page.locator('.live').getByRole('textbox', { name: 'Merchant' })).toBeVisible();
  await expect(page.locator('#take-note')).not.toContainText('example take');
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows a still, correct state and stays usable', async ({ page }) => {
    await page.goto(SITE);
    await expect(page.locator('.line-take')).toBeVisible();
    await page.waitForTimeout(1_200);
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await expect(editExpense(page)).toBeVisible();

    await replayButton(page).click();
    await expect(page.locator('#take-note')).toContainText('Reduced motion is on');
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');

    await editExpense(page).click();
    await expect(page.locator('.live').getByRole('textbox', { name: 'Merchant' })).toBeVisible();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  });
});

for (const width of [1440, 1280, 1024, 768, 390, 320]) {
  test(`has no sideways scroll at ${width} wide, with the action beside its result`, async ({ page }) => {
    const height = width > 767 ? 720 : width === 320 ? 568 : 844;
    await page.setViewportSize({ width, height });
    await page.goto(SITE);
    await expect(page.locator('.line-take')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await expect(editExpense(page)).toBeInViewport({ ratio: 1 });
    await expect(surface(page)).toBeInViewport({ ratio: 1 });
    if (width > 767) await expect(page.locator('.plot')).toBeInViewport({ ratio: 1 });
  });
}
