import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** SITE_URL points these at a production build served under the site's own path and headers. */
const SITE = process.env.SITE_URL ?? 'http://localhost:5184/';

const surface = (page: Page) => page.locator('.live [data-frame-target=surface]');
const drawnHeight = (page: Page) => surface(page).evaluate((el) => el.getBoundingClientRect().height);
const clockMs = async (page: Page) => Number.parseInt((await page.locator('#clock').textContent())!, 10);
const editExpense = (page: Page) => page.locator('.live').getByRole('button', { name: 'Edit expense' });
const openButton = (page: Page) => page.locator('#go');
const cancelButton = (page: Page) => page.locator('#back');
const replayButton = (page: Page) => page.locator('#replay');
const marker = (page: Page) => page.getByRole('slider', { name: /^When (Cancel|Close) lands/ });
const springHandle = (page: Page) => page.getByRole('slider', { name: /^Spring for Open/ });
const curvePath = (page: Page) => page.locator('.plot .line-take').getAttribute('d');
const note = (page: Page) => page.locator('#take-note');
const replayed = (page: Page) => expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 5_000 });
/** A change that replays the take: waits for that replay to start, then to end. */
async function ranAgain(page: Page) {
  await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
  await replayed(page);
}

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

/** Opens the page with the example already dismissed, so a test starts from rest. */
async function openAtRest(page: Page, query = '') {
  await page.goto(`${SITE}${query}`);
  await expect(page.locator('.plot .line-take')).toBeVisible();
  // Any press stops the example waiting to play.
  await note(page).click();
}

test.describe('with the example already seen', () => {
  test.beforeEach(async ({ page }) => {
    await openAtRest(page);
    await waitForStill(page);
  });

  test('the button inside the showcase works', async ({ page }) => {
    const closed = await drawnHeight(page);
    await expect(page.locator('.live')).not.toHaveAttribute('inert');
    await editExpense(page).click();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect.poll(() => drawnHeight(page)).toBeGreaterThan(closed + 100);
    await expect(page.locator('.live').getByRole('textbox', { name: 'Merchant' })).toBeFocused();
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
    await page.waitForTimeout(400);
    const halfway = await drawnHeight(page);
    expect(halfway).toBeGreaterThan(closed + 5);
    await cancelButton(page).click();
    await expect(marker(page)).toBeVisible();
    await expect(page.locator('.plot .line-ghost')).toHaveCount(1);
    await expect(note(page)).toContainText('took over from the current position and speed');
    // The handle says how much speed the reversal started with, and the tangent draws it.
    await expect(marker(page)).toContainText('px/s kept');
    await expect(page.locator('.plot .tangent')).toHaveCount(1);
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
    // The tallest the card gets still clears the time axis under it.
    const card = (await surface(page).boundingBox())!;
    const canvas = (await page.locator('.canvas').boundingBox())!;
    expect(card.y + card.height).toBeLessThan(canvas.y + canvas.height - 20);

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

    await page.locator('#race').click();
    await expect(page.locator('#rival [data-frame-target=surface]')).toBeVisible();
    await expectSameBox();
    await page.locator('#export').click();
    await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
    await expectSameBox();
  });

  test('Finish first holds a live Cancel until Open has settled', async ({ page }) => {
    await page.getByRole('button', { name: 'Finish first' }).click();
    await replayed(page);
    await page.locator('#slow').click();
    const closed = await drawnHeight(page);
    await openButton(page).click();
    await page.waitForTimeout(240);
    await cancelButton(page).click();
    await expect(note(page)).toContainText('waited for the motion to finish');
    await expect(marker(page)).toContainText('waits');
    await expect.poll(() => drawnHeight(page), { timeout: 5_000 }).toBeGreaterThan(closed + 150);
    await expect.poll(() => drawnHeight(page), { timeout: 6_000 }).toBeLessThan(closed + 1);
    await expect(openButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Export can be left mid replay, and reopens on the latest motion', async ({ page }) => {
    await page.locator('#export').click();
    await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
    await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
    await page.locator('#tune').click();
    await page.getByRole('button', { name: 'Lively' }).click();
    await expect(page.getByRole('button', { name: 'Lively' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#export').click();
    await page.getByRole('button', { name: 'Files' }).click();
    await expect(page.locator('.files pre')).toContainText('"stiffness": 520');
    await expect(page.locator('.files pre')).toContainText('"damping": 20');
  });

  test('pressing Cancel too late says so', async ({ page }) => {
    await openButton(page).click();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(1_000);
    await expect(note(page)).toContainText('Open ran to the end');
    await cancelButton(page).click();
    await expect(note(page)).toContainText('nothing to interrupt');
  });

  test('the interruption moves along the timeline, by pointer and keyboard', async ({ page }) => {
    const before = await curvePath(page);
    const bars = await page.locator('.plot .bars').getAttribute('d');
    const frames = await page.locator('.onion-frame').count();
    expect(frames).toBeGreaterThan(5);
    const handle = marker(page);
    await expect(handle).toHaveAttribute('aria-valuenow', '110');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + 8, { steps: 4 });
    await page.mouse.up();
    const moved = Number(await handle.getAttribute('aria-valuenow'));
    expect(moved).toBeGreaterThan(150);
    expect(await curvePath(page)).not.toBe(before);
    // The long exposure is drawn from the same take, so it changes with it.
    expect(await page.locator('.plot .bars').getAttribute('d')).not.toBe(bars);
    expect(await page.locator('.onion-frame').count()).not.toBe(frames);

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(moved - 5));
    await expect(handle).toBeFocused();
    const held = await drawnHeight(page);
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await drawnHeight(page)).not.toBe(held);
  });

  test('the exposure is drawn at the component’s own scale', async ({ page }) => {
    // Hold the take at the interruption. The dot on the line and the card's edge share a height.
    const handle = marker(page);
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    const edge = await surface(page).evaluate((el) => el.getBoundingClientRect().bottom);
    const dot = await page.locator('.plot .playhead-dot').first().evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    expect(Math.abs(edge - dot)).toBeLessThan(1);
  });

  test('the spring handle reshapes Open, by pointer and keyboard', async ({ page }) => {
    const handle = springHandle(page);
    const stiffness = page.getByRole('slider', { name: 'Stiffness', exact: true });
    const damping = page.getByRole('slider', { name: 'Damping', exact: true });
    await expect(handle).toHaveAttribute('aria-valuetext', 'Stiffness 420, damping 34');
    const before = await curvePath(page);
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // To the right is later, so softer. Further down the card's travel is less damped.
    await page.mouse.move(x + 30, y + 30, { steps: 4 });
    await page.mouse.up();
    expect(Number(await stiffness.inputValue())).toBeLessThan(420);
    const ratio = (k: number, c: number) => c / (2 * Math.sqrt(k));
    expect(ratio(Number(await stiffness.inputValue()), Number(await damping.inputValue()))).toBeLessThan(ratio(420, 34));
    expect(await curvePath(page)).not.toBe(before);

    await page.getByRole('button', { name: 'Reset motion' }).click();
    await expect(stiffness).toHaveValue('420');
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(stiffness).toHaveValue('430');
    await page.keyboard.press('ArrowUp');
    await expect(damping).toHaveValue('35');
    await expect(handle).toBeFocused();
  });

  test('each interruption rule changes the outcome of the same take', async ({ page }) => {
    await page.getByRole('button', { name: 'Ignore it' }).click();
    await expect(page.getByRole('button', { name: 'Ignore it' })).toHaveAttribute('aria-pressed', 'true');
    await replayed(page);
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(marker(page)).toContainText('ignored');
    const ignored = await drawnHeight(page);

    await page.getByRole('button', { name: 'Finish first' }).click();
    await replayed(page);
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
    await replayed(page);
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
    await replayed(page);
    expect(Math.abs((await drawnHeight(page)) - during)).toBeLessThan(40);
    await expect(note(page)).not.toContainText('example take');
    await expect(marker(page)).toBeVisible();
  });

  test('Tune shows each spring with its facts, and Reset restores the motion', async ({ page }) => {
    await expect(page.locator('#tune')).toHaveAttribute('aria-pressed', 'true');
    const stiffness = page.getByRole('slider', { name: 'Stiffness', exact: true });
    await expect(stiffness).toHaveValue('420');
    await expect(page.getByRole('slider', { name: 'Damping', exact: true })).toHaveValue('34');
    await expect(page.locator('#facts')).toContainText('Ratio 0.83');
    await expect(page.locator('#facts')).toContainText('Overshoot 0.9%');
    await page.getByRole('group', { name: 'Curve to edit' }).getByRole('button', { name: 'Mid flight' }).click();
    await expect(stiffness).toHaveValue('700');
    await page.getByRole('group', { name: 'Curve to edit' }).getByRole('button', { name: 'Open' }).click();

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

  test('a race runs a second copy of the component on the same take', async ({ page }) => {
    await page.locator('#race').click();
    const rival = page.locator('#rival [data-frame-target=surface]');
    await expect(rival).toBeVisible();
    await expect(page.locator('.plot .line-rival')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Spring for Open on side B' }).getByRole('button', { name: 'Lively' })).toHaveAttribute('aria-pressed', 'true');
    await ranAgain(page);
    const a = Number.parseInt((await page.locator('#settle-a').textContent())!, 10);
    const b = Number.parseInt((await page.locator('#settle-b').textContent())!, 10);
    expect(a).not.toBe(b);
    await expect(page.locator('#race-note')).toContainText(`B comes to rest ${Math.abs(b - a)} ms ${b > a ? 'later' : 'sooner'}`);

    // The second copy is a real component that got the same commands, so it also ends closed.
    expect(Math.abs((await rival.evaluate((el) => el.getBoundingClientRect().height)) - (await drawnHeight(page)))).toBeLessThan(0.5);
    await expect(page.locator('#rival')).toHaveAttribute('inert', '');

    // Another rule on side B ends somewhere else entirely.
    await page.getByRole('group', { name: 'What Cancel does on side B' }).getByRole('button', { name: 'Ignore' }).click();
    await ranAgain(page);
    await expect.poll(() => rival.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan((await drawnHeight(page)) + 150);

    // The same spring and rule on both sides is a dead heat.
    await page.getByRole('group', { name: 'What Cancel does on side B' }).getByRole('button', { name: 'Reverse' }).click();
    await page.getByRole('group', { name: 'Spring for Open on side B' }).getByRole('button', { name: 'Quiet' }).click();
    await expect(page.locator('#race-note')).toContainText('They come to rest together');
    await page.locator('#tune').click();
    await expect(page.locator('.plot .line-rival')).toHaveCount(0);
  });

  test('the exported copy reproduces the same take, and the download holds the edit', async ({ page }) => {
    await page.getByRole('button', { name: 'Soft' }).click();
    await replayed(page);
    await page.locator('#export').click();
    const exported = page.locator('#exported [data-frame-target=surface]');
    await expect(exported).toBeVisible();
    await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
    await replayed(page);

    const seekHandle = page.getByRole('slider', { name: 'Time in the take' });
    await seekHandle.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+ArrowRight');
      const [a, b] = await Promise.all([drawnHeight(page), exported.evaluate((el) => el.getBoundingClientRect().height)]);
      expect(Math.abs(a - b)).toBeLessThan(0.01);
      await expect.poll(() => page.locator('#edge-exported').textContent()).toBe(await page.locator('#edge-ours').textContent());
      await expect(page.locator('#edge-gap')).toHaveText('0.000 px');
    }

    await page.getByRole('button', { name: 'Files' }).click();
    await expect(page.locator('.files pre')).toContainText('"stiffness": 170');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
    expect(download.suggestedFilename()).toBe('expense-panel-motion.zip');
    const zip = readFileSync(await download.path()).toString('latin1');
    expect(zip).toContain('expense-panel-motion/motion.config.ts');
    expect(zip).toContain('"stiffness": 170');

    await page.keyboard.press('Escape');
    await expect(page.locator('#tune')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#export')).toBeFocused();
  });

  test('disabled controls keep focus and do nothing', async ({ page }) => {
    await expect(cancelButton(page)).toHaveAttribute('aria-disabled', 'true');
    await cancelButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(cancelButton(page)).toBeFocused();
    await expect(note(page)).toContainText('example take');
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

test.describe('what a visitor takes away', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('the spring copies as a Frame curve and as CSS the browser accepts', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Reading the clipboard back needs a permission only Chromium grants.');
    await openAtRest(page);
    await page.getByRole('button', { name: 'Lively' }).click();
    await page.getByRole('button', { name: 'Copy the spring as a Frame curve' }).click();
    await expect(page.getByRole('button', { name: 'Copy the spring as a Frame curve' }).locator('.on')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("{ type: 'spring', stiffness: 520, damping: 20, mass: 1 }");

    await page.getByRole('button', { name: 'Copy the spring as CSS linear easing' }).click();
    const css = await page.evaluate(() => navigator.clipboard.readText());
    expect(css).toMatch(/^transition-duration: \d+ms;\ntransition-timing-function: linear\(0, .+, 1\);$/);
    const easing = css.slice(css.indexOf('linear('), -1);
    expect(await page.evaluate((value) => CSS.supports('transition-timing-function', value), easing)).toBe(true);
    // Lively passes its target, and the copied easing has to keep that.
    const peak = Math.max(...easing.slice(7, -1).split(',').map((part) => Number(part.trim().split(' ')[0])));
    expect(peak).toBeGreaterThan(1.05);
  });

  test('the address keeps the motion, and a copied link restores it', async ({ page, browserName }) => {
    await openAtRest(page);
    await page.getByRole('button', { name: 'Lively' }).click();
    await page.getByRole('button', { name: 'Finish first' }).click();
    const handle = marker(page);
    await handle.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '135');
    await expect.poll(() => page.url()).toContain('k=520&d=20&r=queue&at=135');
    if (browserName === 'chromium') {
      await page.getByRole('button', { name: 'Copy a link to this motion' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    }

    await page.goto(page.url());
    await expect(page.locator('.plot .line-take')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lively' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Finish first' })).toHaveAttribute('aria-pressed', 'true');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '135');

    // A plain visit keeps a plain address, and nonsense in one is ignored.
    await page.getByRole('button', { name: 'Reset motion' }).click();
    await marker(page).focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await openAtRest(page, '?c=nothing&k=99999&d=abc&r=explode&at=-4');
    await expect(page.getByRole('slider', { name: 'Stiffness', exact: true })).toHaveValue('420');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '110');
  });
});

test.describe('the other registered components', () => {
  test('the status menu opens, picks by pointer and keyboard, and reverses mid flight', async ({ page }) => {
    await openAtRest(page);
    await page.getByRole('group', { name: 'Component' }).getByRole('button', { name: 'Status menu' }).click();
    await expect.poll(() => new URL(page.url()).search).toBe('?c=menu');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '100');
    const live = page.locator('.live');
    const trigger = live.getByRole('button', { name: /In review/ });
    await note(page).click();
    await waitForStill(page);
    const closed = (await surface(page).boundingBox())!;

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await surface(page).boundingBox())!.height).toBeGreaterThan(closed.height + 150);
    expect((await surface(page).boundingBox())!.width).toBeGreaterThan(closed.width + 50);
    await live.getByRole('menuitemradio', { name: /Done/ }).click();
    await expect(live.getByRole('button', { name: /Done/ })).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await surface(page).boundingBox())!.height).toBeLessThan(closed.height + 1);

    // By keyboard: down opens, down again enters the list at the checked item, a digit picks.
    await live.getByRole('button', { name: /Done/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(live.getByRole('menu')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(live.getByRole('menuitemradio', { name: /Done/ })).toBeFocused();
    await page.keyboard.press('2');
    await expect(live.getByRole('button', { name: /In progress/ })).toBeFocused();
    await expect(live.getByRole('button', { name: /In progress/ })).toHaveAttribute('aria-expanded', 'false');

    // Toggle twice quickly. The second press lands mid flight and the take records it.
    await page.locator('#slow').click();
    await page.locator('#go').click();
    await page.waitForTimeout(300);
    await page.locator('#back').click();
    await expect(note(page)).toContainText('Close landed');
    await expect(note(page)).toContainText('took over from the current position and speed');
  });

  test('the bottom sheet slides in its screen, adds a stop, and is followed by its top edge', async ({ page }) => {
    await openAtRest(page, '?c=sheet');
    await waitForStillSheet(page);
    const live = page.locator('.live');
    const sheet = live.locator('[data-frame-target=sheet]');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#read-edge')).toHaveText('352.0 px');
    await live.getByRole('button', { name: 'Add a stop' }).click();
    await expect(sheet).toBeVisible();
    await expect(live.getByRole('textbox', { name: 'Stop' })).toBeFocused();
    const screen = (await live.locator('.sc-phone').boundingBox())!;
    await expect.poll(async () => Math.abs((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height - (screen.y + screen.height))).toBeLessThan(1.5);
    // The readout is the sheet's real top edge, in pixels from the top of its screen.
    const top = (await sheet.boundingBox())!.y - screen.y;
    await expect.poll(async () => Math.abs(Number.parseFloat((await page.locator('#read-edge').textContent())!) - top)).toBeLessThan(1.5);

    await live.getByRole('textbox', { name: 'Stop' }).fill('Tide pools');
    await live.getByRole('button', { name: 'Evening' }).click();
    await live.getByRole('button', { name: 'Add to plan' }).click();
    await expect(sheet).toBeHidden();
    await expect(live.locator('.sc-plan li')).toHaveCount(3);
    await expect(live.locator('.sc-plan li').nth(2)).toContainText('19:15');
    await expect(live.locator('.sc-plan li').nth(2)).toContainText('Tide pools');
    await expect(live.getByText('3 stops')).toBeVisible();

    // Escape closes it, and an empty name cannot be added.
    await live.getByRole('button', { name: 'Add a stop' }).click();
    await live.getByRole('textbox', { name: 'Stop' }).fill('  ');
    await expect(live.getByRole('button', { name: 'Add to plan' })).toHaveAttribute('aria-disabled', 'true');
    await live.getByRole('button', { name: 'Add to plan' }).focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(live.locator('.sc-plan li')).toHaveCount(3);
  });

  test('the exported copy of the menu and the sheet matches the page', async ({ page }) => {
    for (const [query, name] of [['?c=menu', 'status-menu-motion'], ['?c=sheet', 'stop-sheet-motion']] as const) {
      await openAtRest(page, query);
      await page.locator('#export').click();
      await expect(page.locator('#exported [data-frame-root]')).toBeVisible();
      await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
      await replayed(page);
      const seekHandle = page.getByRole('slider', { name: 'Time in the take' });
      await seekHandle.focus();
      await page.keyboard.press('Home');
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Shift+ArrowRight');
        await expect.poll(() => page.locator('#edge-gap').textContent()).toBe('0.000 px');
      }
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
      expect(download.suggestedFilename()).toBe(`${name}.zip`);
    }
  });
});

async function waitForStillSheet(page: Page) {
  await expect(page.locator('#replay .on')).toHaveText('Replay');
  await page.waitForTimeout(100);
}

test('passes automated accessibility checks in each mode and component', async ({ page }) => {
  await openAtRest(page);
  const violations = async () => (await new AxeBuilder({ page }).analyze()).violations.map((item) => `${item.id}: ${item.nodes[0]?.html}`);
  expect(await violations()).toEqual([]);
  // Colors are read once a control's short transition has ended.
  await page.locator('#race').click();
  await ranAgain(page);
  await page.waitForTimeout(250);
  expect(await violations()).toEqual([]);
  await page.locator('#export').click();
  await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
  await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
  await replayed(page);
  await page.waitForTimeout(250);
  expect(await violations()).toEqual([]);

  await openAtRest(page, '?c=menu');
  await page.locator('.live').getByRole('button', { name: /In review/ }).click();
  await page.waitForTimeout(900);
  expect(await violations()).toEqual([]);
  await openAtRest(page, '?c=sheet');
  await page.locator('.live').getByRole('button', { name: 'Add a stop' }).click();
  await page.waitForTimeout(900);
  expect(await violations()).toEqual([]);
});

test('the example plays once on its own, only after the demo is in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${SITE}#details`);
  await expect(page.locator('.plot .line-take')).toBeVisible();
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
  await expect(note(page)).not.toContainText('example take');
});

test('nothing moves on its own once the stage has left the screen', async ({ page }) => {
  await openAtRest(page);
  await expect(page.locator('.demo')).toHaveAttribute('data-onscreen', '');
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((item) => item.playState === 'running').length)).toBeGreaterThan(0);
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await expect(page.locator('.demo')).not.toHaveAttribute('data-onscreen', '');
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((item) => item.playState === 'running').length)).toBe(0);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows a still, correct state and stays usable', async ({ page }) => {
    await page.goto(SITE);
    await expect(page.locator('.plot .line-take')).toBeVisible();
    await page.waitForTimeout(1_200);
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await expect(editExpense(page)).toBeVisible();
    // The exposure is a drawing, not a motion, so it is all there.
    expect(await page.locator('.onion-frame').count()).toBeGreaterThan(5);
    await expect(page.locator('.plot .line-ghost')).toHaveCount(1);

    await replayButton(page).click();
    await expect(note(page)).toContainText('Reduced motion is on');
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');

    await page.locator('#race').click();
    await expect(page.locator('#rival [data-frame-target=surface]')).toBeVisible();
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

    await editExpense(page).click();
    await expect(page.locator('.live').getByRole('textbox', { name: 'Merchant' })).toBeVisible();
    await expect(cancelButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  });
});

for (const width of [1440, 1280, 1024, 768, 390, 320]) {
  test(`has no sideways scroll at ${width} wide, with the action beside its result`, async ({ page }) => {
    const height = width > 767 ? 720 : width === 320 ? 568 : 844;
    await page.setViewportSize({ width, height });
    for (const query of ['', '?c=menu', '?c=sheet']) {
      await page.goto(`${SITE}${query}`);
      await expect(page.locator('.plot .line-take')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      // The sheet's screen is 352 px tall, a little more than is left under the title at 320 by 568.
      await expect(page.locator('.live [data-frame-root]')).toBeInViewport({ ratio: width === 320 ? 0.95 : 1 });
      if (width > 767 || width === 390) await expect(page.locator('.plot')).toBeInViewport({ ratio: 1 });
      // The instrument never slides under the component it is measuring.
      const component = (await page.locator('.live [data-frame-root]').boundingBox())!;
      const plot = (await page.locator('.plot').boundingBox())!;
      expect(plot.x >= component.x + component.width || plot.y >= component.y + component.height).toBe(true);
    }
    await page.goto(SITE);
    await expect(editExpense(page)).toBeInViewport({ ratio: 1 });
    await expect(surface(page)).toBeInViewport({ ratio: 1 });
  });
}
