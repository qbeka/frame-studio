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

/** The springs and the rule are behind Tune, which opens on demand. */
async function openTune(page: Page) {
  if ((await page.locator('#tune').getAttribute('aria-pressed')) !== 'true') await page.locator('#tune').click();
  await expect(page.getByRole('slider', { name: 'Stiffness', exact: true })).toBeVisible();
}

/** What the plate has printed, as a number that changes when the print does. */
const plateInk = (page: Page) =>
  page.locator('.canvas .plate').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i]!;
    return sum;
  });

const grabBar = (page: Page) => page.locator('#grab');
const edgePx = async (page: Page) => Number.parseFloat((await page.locator('#read-edge').textContent())!);

/** Drags from a point by `dy` pixels over `steps` pointer moves, without letting go. */
async function pull(page: Page, from: { x: number; y: number }, dy: number, steps = 10, pauseMs = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x, from.y + (dy * i) / steps);
    await page.waitForTimeout(pauseMs);
  }
}

const centre = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Opens the page with the example already dismissed, so a test starts from rest. */
async function openAtRest(page: Page, query = '') {
  await page.goto(`${SITE}${query}`);
  await expect(page.locator('.plot .line-take')).toBeVisible();
  // Any press stops the example waiting to play.
  await note(page).click();
  // The stage has arrived by the time a test touches it.
  await page.waitForFunction(() => document.getElementById('stage')!.getAnimations().every((item) => item.playState !== 'running'));
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

  test('content that is leaving stays drawn until its exit ends', async ({ page }) => {
    const form = page.locator('.live [data-frame-target=form]');
    await openButton(page).click();
    await waitForStill(page);
    await page.locator('#slow').click();
    await cancelButton(page).click();
    // The form is out of the document flow at once, and still on screen while it fades.
    await expect(form).toHaveAttribute('data-frame-exiting', '');
    await expect(form).toBeVisible();
    expect((await form.boundingBox())!.height).toBeGreaterThan(100);
    expect(Number(await form.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0);
    await expect(form).toBeHidden({ timeout: 5_000 });
    await expect(form).not.toHaveAttribute('data-frame-exiting', '');
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
      expect(Math.abs(now.height - box.height)).toBeLessThan(0.01);
      expect(Math.abs(now.width - box.width)).toBeLessThan(0.01);
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

    await page.locator('#tune').click();
    await expect(page.getByRole('group', { name: 'Motion settings' })).toBeVisible();
    await expectSameBox();
    // The settings fit the rail, so it has nothing to scroll.
    expect(await page.locator('.rail').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
    await page.locator('#race').click();
    await expect(page.locator('#rival [data-frame-target=surface]')).toBeVisible();
    await expect(page.locator('.rail')).toHaveCount(0);
    await expectSameBox();
    await page.locator('#export').click();
    await expect(page.locator('#exported [data-frame-target=surface]')).toBeVisible();
    await expectSameBox();
    expect(await page.locator('.rail').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
  });

  test('Finish first holds a live Cancel until Open has settled', async ({ page }) => {
    await openTune(page);
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
    await expect(page.locator('#exported')).toHaveCount(0);
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
    const ink = await plateInk(page);
    expect(ink).toBeGreaterThan(10_000);
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
    // The plate is exposed from the same take, and a later turn travels further and prints more.
    await expect.poll(() => plateInk(page)).toBeGreaterThan(ink * 1.1);

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(moved - 5));
    await expect(handle).toBeFocused();
    const held = await drawnHeight(page);
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await drawnHeight(page)).not.toBe(held);
  });

  test('the exposure is drawn at the scale of the component', async ({ page }) => {
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
    await openTune(page);
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
    await openTune(page);
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

  test('Tune opens on demand, shows each spring with its facts, and Reset restores the motion', async ({ page }) => {
    await expect(page.locator('#tune')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.rail')).toHaveCount(0);
    await page.keyboard.press('t');
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
    await page.locator('#race').click();
    await expect(page.locator('.plot .line-rival')).toHaveCount(0);
    await expect(page.locator('#rival')).toHaveCount(0);
  });

  test('the exported copy reproduces the same take, and the download holds the edit', async ({ page }) => {
    await openTune(page);
    await page.getByRole('button', { name: 'Soft' }).click();
    await replayed(page);
    await page.locator('#export').click();
    const exported = page.locator('#exported [data-frame-target=surface]');
    await expect(exported).toBeVisible();
    await expect(replayButton(page).locator('.on')).toHaveText('Pause', { timeout: 5_000 });
    await replayed(page);

    // With the copy and its panel open the speed strip does the scrubbing.
    const seekHandle = page.getByRole('slider', { name: 'Moment on the speed strip' });
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
    await expect(page.locator('#export')).toHaveAttribute('aria-pressed', 'false');
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

/** Every number in a path, for comparing two drawings of the same take. */
const numbers = (d: string | null) => (d ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);

test.describe('by hand', () => {
  test.beforeEach(async ({ page }) => {
    await openAtRest(page);
    await waitForStill(page);
  });

  test('the grab bar drags the card open, the edge stays under the pointer, and the spring gets the speed', async ({ page }) => {
    const closed = await drawnHeight(page);
    const from = await centre(page, '#grab');
    await recordHeights(page);
    await pull(page, from, 120, 12);
    // The hand has it. The state changed when it took hold, and the edge is where the pointer put it.
    await expect(page.locator('#read-state')).toHaveText('Editing');
    await expect(page.locator('.demo')).toHaveAttribute('data-hand', 'true');
    await expect(note(page)).toContainText('Your hand has it now');
    // The hand took hold on the first move, 10 px in, so the edge has followed the other 110.
    await expect.poll(async () => Math.abs((await drawnHeight(page)) - (closed + 110))).toBeLessThan(1.5);
    expect(Math.abs((await edgePx(page)) - (closed + 110))).toBeLessThan(1.5);
    await expect(page.locator('.plot .line-ahead')).toHaveCount(0);

    await page.mouse.up();
    await expect(page.locator('.demo')).not.toHaveAttribute('data-hand', 'true');
    await expect(page.locator('.plot .let-go')).toHaveCount(1);
    await expect(page.locator('.plot .let-go')).toContainText('Let go');
    await waitForStill(page);
    expect(await drawnHeight(page)).toBeGreaterThan(closed + 200);
    await expect(page.locator('#read-state')).toHaveText('Editing');
    await expect(note(page)).toContainText('One hold by hand');
    await expect(page.locator('.plot .line-hand')).toHaveCount(1);
    expect(await page.locator('.plot .hand-dot').count()).toBeGreaterThan(5);
    // Nothing jumped: not when the hand landed, and not when the spring took over.
    const heights = await page.evaluate(() => (window as unknown as { __heights: number[] }).__heights);
    const steps = heights.slice(1).map((value, i) => Math.abs(value - heights[i]!));
    expect(Math.max(...steps)).toBeLessThan(40);
    // A take with a hand in it has no press to move, and its presses stay where they fell.
    await expect(marker(page)).toHaveCount(0);
  });

  test('a harder throw hands on more speed', async ({ page }) => {
    const speedOf = async (pauseMs: number) => {
      await openAtRest(page);
      await waitForStill(page);
      const from = await centre(page, '#grab');
      await pull(page, from, 110, 10, pauseMs);
      await page.mouse.up();
      await expect(page.locator('.plot .let-go em')).toBeVisible();
      const text = (await page.locator('.plot .let-go em').textContent())!;
      return text === 'At rest' ? 0 : Number(text.replace(/,/g, '').match(/\d+/)![0]);
    };
    const slow = await speedOf(28);
    const fast = await speedOf(5);
    expect(slow).toBeGreaterThan(50);
    expect(fast).toBeGreaterThan(slow * 1.5);
    // A hand that stops before it lets go hands on no speed at all.
    await openAtRest(page);
    await waitForStill(page);
    await pull(page, await centre(page, '#grab'), 110, 10, 5);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect(page.locator('.plot .let-go em')).toHaveText('At rest');
  });

  test('a drag that starts on a button takes hold without pressing it, and a press that does not move is still a press', async ({ page }) => {
    const closed = await drawnHeight(page);
    const button = await centre(page, '.live .fx-open .fx-button');
    await pull(page, button, 150, 10);
    await expect(page.locator('#read-state')).toHaveText('Editing');
    await page.mouse.up();
    await waitForStill(page);
    expect(await drawnHeight(page)).toBeGreaterThan(closed + 200);
    // Had the button also been pressed, the take would hold a press as well as the hand.
    await expect(note(page)).toContainText('One hold by hand');
    await expect(page.locator('.plot .pressed')).toHaveCount(0);

    // A drag that starts in a field is the field's, for selecting what is in it.
    const field = await centre(page, '.live .fx-form textarea');
    await pull(page, field, 60, 6);
    await page.mouse.up();
    await expect(page.locator('#read-state')).toHaveText('Editing');
    await expect(page.locator('.plot .let-go')).toHaveCount(1);

    await page.locator('.live').getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => drawnHeight(page)).toBeLessThan(closed + 1);
    await expect(note(page)).toContainText('Cancel landed');
    await editExpense(page).click();
    await expect.poll(() => drawnHeight(page)).toBeGreaterThan(closed + 200);
  });

  test('catching it mid flight keeps the edge where it was, and throwing it back closes it', async ({ page }) => {
    await page.locator('#slow').click();
    const closed = await drawnHeight(page);
    await openButton(page).click();
    await page.waitForTimeout(320);
    expect(await drawnHeight(page)).toBeGreaterThan(closed + 10);
    await recordHeights(page);
    const body = await centre(page, '.live .fx-summary');
    await pull(page, body, -70, 8);
    // Taking hold of an opening card is taking hold of the way back.
    await expect(page.locator('#read-state')).toHaveText('Compact');
    await expect(note(page)).toContainText('Your hand has it now');
    await page.mouse.up();
    await expect.poll(() => drawnHeight(page), { timeout: 6_000 }).toBeLessThan(closed + 1);
    const heights = await page.evaluate(() => (window as unknown as { __heights: number[] }).__heights);
    const steps = heights.slice(1).map((value, i) => Math.abs(value - heights[i]!));
    expect(Math.max(...steps)).toBeLessThan(40);
    await expect(note(page)).toContainText('One hold by hand');
    // The press that started the take is still on the trace, where it fell.
    await expect(page.locator('.plot .first')).toHaveText('Open');
  });

  test('the keyboard moves the edge from the grab bar, and lets go when the keys stop', async ({ page }) => {
    const closed = await drawnHeight(page);
    await grabBar(page).focus();
    await expect(grabBar(page)).toHaveAttribute('aria-valuetext', 'Compact');
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowDown');
    await expect(page.locator('#read-state')).toHaveText('Editing');
    await expect(page.locator('.demo')).toHaveAttribute('data-hand', 'true');
    expect(await drawnHeight(page)).toBeGreaterThan(closed + 100);
    // The keys have stopped, so the hand lets go, past the middle, and the spring finishes the job.
    await expect(page.locator('.demo')).not.toHaveAttribute('data-hand', 'true');
    await expect.poll(() => drawnHeight(page)).toBeGreaterThan(closed + 200);
    await waitForStill(page);
    await expect(grabBar(page)).toHaveAttribute('aria-valuetext', 'Editing');
    await expect(grabBar(page)).toBeFocused();
    // Enter on the bar is the component's own press.
    await page.keyboard.press('Enter');
    await expect.poll(() => drawnHeight(page)).toBeLessThan(closed + 1);
    // A short push that never reaches the middle falls back.
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown');
    await expect.poll(() => drawnHeight(page)).toBeGreaterThan(closed + 30);
    await expect.poll(() => drawnHeight(page), { timeout: 4_000 }).toBeLessThan(closed + 1);
    await expect(page.locator('#read-state')).toHaveText('Compact');
  });

  test('on a touch screen only the bar takes hold, so the component still scrolls the page', async ({ page }) => {
    const touch = (selector: string, dy: number) =>
      page.evaluate(
        async ({ selector, dy }) => {
          const element = document.querySelector(selector)!;
          const box = element.getBoundingClientRect();
          const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
          const fire = (target: EventTarget, type: string, y: number) =>
            target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', button: 0, clientX: at.clientX, clientY: y }));
          fire(element, 'pointerdown', at.clientY);
          for (let i = 1; i <= 8; i += 1) {
            fire(window, 'pointermove', at.clientY + (dy * i) / 8);
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
          const held = document.querySelector('.demo')!.hasAttribute('data-hand');
          fire(window, 'pointerup', at.clientY + dy);
          return held;
        },
        { selector, dy },
      );
    expect(await touch('.live .fx-summary', 120)).toBe(false);
    await expect(page.locator('#read-state')).toHaveText('Compact');
    expect(await touch('#grab', 140)).toBe(true);
    await expect(page.locator('#read-state')).toHaveText('Editing');
  });

  test('the sheet is pulled up by its bar and the menu down by its own, each along its own edge', async ({ page }) => {
    await openAtRest(page, '?c=sheet');
    await waitForStillSheet(page);
    const sheet = page.locator('.live [data-frame-target=sheet]');
    await expect(sheet).toBeHidden();
    await pull(page, await centre(page, '#grab'), -150, 10);
    await expect(sheet).toBeVisible();
    await expect(page.locator('#read-state')).toHaveText('Open');
    const top = async () => (await sheet.boundingBox())!.y - (await page.locator('.live .sc-phone').boundingBox())!.y;
    await expect.poll(async () => Math.abs((await top()) - (352 - 135))).toBeLessThan(2);
    await page.mouse.up();
    await expect.poll(top, { timeout: 4_000 }).toBeLessThan(140);

    await openAtRest(page, '?c=menu');
    await waitForStillSheet(page);
    const closed = (await surface(page).boundingBox())!.height;
    await pull(page, await centre(page, '#grab'), 130, 10);
    await expect(page.locator('#read-state')).toHaveText('Open');
    await page.mouse.up();
    await expect.poll(async () => (await surface(page).boundingBox())!.height, { timeout: 4_000 }).toBeGreaterThan(closed + 150);
  });

  test('a link to a hand take restores exactly that take', async ({ page }) => {
    await pull(page, await centre(page, '#grab'), 120, 12);
    await page.mouse.up();
    await waitForStill(page);
    await page.waitForTimeout(400);
    await expect.poll(() => new URL(page.url()).searchParams.get('t')?.length ?? 0).toBeGreaterThan(20);
    const before = numbers(await curvePath(page));
    const said = await note(page).textContent();
    const speed = await page.locator('.plot .let-go em').textContent();

    await page.goto(page.url());
    await expect(page.locator('.plot .line-take')).toBeVisible();
    await note(page).click();
    await expect(note(page)).toHaveText(said!);
    await expect(page.locator('.plot .let-go em')).toHaveText(speed!);
    await expect(page.getByRole('button', { name: 'Yours' })).toHaveAttribute('aria-pressed', 'true');
    const after = numbers(await curvePath(page));
    expect(after.length).toBe(before.length);
    // The same samples at the same moments. A tenth of a pixel is the precision the path is written to.
    expect(Math.max(...after.map((value, i) => Math.abs(value - before[i]!)))).toBeLessThanOrEqual(0.11);
    // It plays back like any other take.
    await replayButton(page).click();
    await ranAgainFromPause(page);
  });
});

async function ranAgainFromPause(page: Page) {
  await expect(replayButton(page).locator('.on')).toHaveText('Replay', { timeout: 6_000 });
}

test.describe('the takes on the strip', () => {
  test.beforeEach(async ({ page }) => {
    await openAtRest(page);
    await waitForStill(page);
  });

  test('each example plays, prints its own plate and has its own address', async ({ page }) => {
    const frame = (name: string) => page.getByRole('group', { name: 'Takes' }).getByRole('button', { name });
    await expect(frame('Reverse')).toHaveAttribute('aria-pressed', 'true');
    await expect(frame('Yours')).toHaveAttribute('aria-disabled', 'true');
    const reverse = await plateInk(page);

    await frame('Throw and catch').click();
    await ranAgain(page);
    await expect(frame('Throw and catch')).toHaveAttribute('aria-pressed', 'true');
    await expect(note(page)).toContainText('Throw and catch, an example written as pointer samples');
    await expect(page.locator('.plot .let-go')).toHaveCount(2);
    await expect.poll(() => new URL(page.url()).search).toBe('?take=throw-and-catch');
    expect(await plateInk(page)).not.toBe(reverse);
    // The catch lands on the motion: the edge does not jump when the second hold begins, 300 ms in.
    const seek = page.getByRole('slider', { name: 'Time in the take' });
    await seek.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    expect(await clockMs(page)).toBe(290);
    const before = await edgePx(page);
    await page.keyboard.press('ArrowRight');
    const caught = await edgePx(page);
    await page.keyboard.press('ArrowRight');
    const after = await edgePx(page);
    // The spring is turning at the far end here, so 10 ms either side is a few pixels at most.
    expect(Math.abs(caught - before)).toBeLessThan(6);
    expect(Math.abs(after - caught)).toBeLessThan(6);

    await frame('Double tap').click();
    await ranAgain(page);
    await expect(page.locator('.plot .marker')).toHaveCount(3);
    await expect(note(page)).toContainText('Double tap, with 4 presses');
    await frame('Slow pull').click();
    await ranAgain(page);
    await expect(page.locator('.plot .let-go em')).toHaveText('At rest');
    await frame('Late cancel').click();
    await ranAgain(page);
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '300');

    // A link to an example opens on it.
    await page.goto(`${SITE}?take=slow-pull`);
    await expect(page.locator('.plot .line-hand')).toHaveCount(1);
    await expect(frame('Slow pull')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the visitor\'s own take is kept beside the examples', async ({ page }) => {
    const frame = (name: string) => page.getByRole('group', { name: 'Takes' }).getByRole('button', { name });
    await openButton(page).click();
    await page.waitForTimeout(90);
    await cancelButton(page).click();
    await waitForStill(page);
    await expect(frame('Yours')).toHaveAttribute('aria-pressed', 'true');
    const mine = await note(page).textContent();
    await frame('Late cancel').click();
    await ranAgain(page);
    await expect(frame('Yours')).toHaveAttribute('aria-pressed', 'false');
    await expect(frame('Yours')).not.toHaveAttribute('aria-disabled', 'true');
    await frame('Yours').click();
    await ranAgain(page);
    await expect(note(page)).toHaveText(mine!);
  });

  test('Save plate downloads the print as an image', async ({ page }) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-plate').click()]);
    expect(download.suggestedFilename()).toBe('frame-plate-card.png');
    const png = readFileSync(await download.path());
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1600);
    expect(png.readUInt32BE(20)).toBe(1000);
    expect(png.length).toBeGreaterThan(20_000);
    await expect(page.locator('#save-plate .on')).toHaveText('Saved');
  });

  test('the shortcuts are listed, and they do what the list says', async ({ page }) => {
    await page.keyboard.press('?');
    const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(list).toBeVisible();
    await expect(list).toBeFocused();
    await expect(list).toContainText('Replay the take, or pause it');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await page.locator('#keys').click();
    await expect(list).toBeVisible();
    await list.getByRole('button', { name: 'Close the list of shortcuts' }).click();
    await expect(list).toHaveCount(0);
    await expect(page.locator('#keys')).toBeFocused();

    await page.locator('#keys').blur();
    await page.keyboard.press('s');
    await expect(page.locator('#slow')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('r');
    await expect(replayButton(page).locator('.on')).toHaveText('Pause');
    await page.keyboard.press('r');
    await expect(replayButton(page).locator('.on')).toHaveText('Replay');
    await page.keyboard.press('s');
    await page.keyboard.press('4');
    await expect(page.getByRole('group', { name: 'Takes' }).getByRole('button', { name: 'Throw and catch' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('a');
    await expect(page.locator('#rival [data-frame-root]')).toBeVisible();
    await page.keyboard.press('e');
    await expect(page.locator('#exported [data-frame-root]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#exported')).toHaveCount(0);
    // A key typed into the component is the component's.
    await editExpense(page).click();
    await page.locator('.live').getByRole('textbox', { name: 'Merchant' }).fill('ears');
    await expect(page.locator('#slow')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#exported')).toHaveCount(0);
  });
});

test.describe('the essay under the stage', () => {
  test('its live figures are worked out from the stage, and share one interruption', async ({ page }) => {
    await openAtRest(page);
    const rules = page.locator('.mount[data-figure=rules]');
    await rules.scrollIntoViewIfNeeded();
    await expect(rules.locator('.rule canvas')).toHaveCount(3);
    await expect(rules.locator('.rule').nth(0)).toContainText('Cancel takes over at once and keeps');
    await expect(rules.locator('.rule').nth(1)).toContainText('then Cancel runs at');
    await expect(rules.locator('.rule').nth(2)).toContainText('Cancel is dropped');
    const kept = await rules.locator('.rule p').first().textContent();
    const delay = page.locator('#rules-delay');
    await expect(delay).toHaveValue('110');
    await delay.focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
    await expect(delay).toHaveValue('150');
    await expect(rules.locator('output')).toHaveText('150 ms into Open');
    expect(await rules.locator('.rule p').first().textContent()).not.toBe(kept);
    // Each plate is a real drawing.
    const inked = await rules.locator('.rule canvas').first().evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count += 1;
      return count;
    });
    expect(inked).toBeGreaterThan(2_000);

    const css = page.locator('.mount[data-figure=css]');
    await css.scrollIntoViewIfNeeded();
    await expect(page.locator('#css-delay')).toHaveValue('150');
    await expect(page.locator('#css-turn')).toContainText('the transition leaves it at 0 px/s');
    // The written easing stays inside the bound the page quotes for it.
    const widest = Number((await page.locator('#css-read b').last().textContent())!.replace('%', ''));
    expect(widest).toBeGreaterThan(0);
    expect(widest).toBeLessThan(0.2);

    // Tuning the stage redraws them, and another component brings its own words.
    await page.locator('#stage').scrollIntoViewIfNeeded();
    await page.getByRole('group', { name: 'Component' }).getByRole('button', { name: 'Status menu' }).click();
    await rules.scrollIntoViewIfNeeded();
    await expect(rules.locator('.rule').nth(0)).toContainText('Close takes over at once');
  });

  test('the figures are a chunk of their own, fetched only when the essay is near', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (/essay(\.tsx|-[\w-]+\.js)/.test(request.url())) scripts.push(request.url());
    });
    await page.goto(SITE);
    await expect(page.locator('.plot .line-take')).toBeVisible();
    await page.waitForTimeout(600);
    expect(scripts).toEqual([]);
    await page.locator('.mount[data-figure=css]').scrollIntoViewIfNeeded();
    await expect(page.locator('.mount[data-figure=css] svg').first()).toBeVisible();
    expect(scripts.length).toBeGreaterThan(0);
  });

  test('the page carries a share card and a tab icon', async ({ page, request }) => {
    await page.goto(SITE);
    const content = (property: string) => page.locator(`meta[property="${property}"]`).getAttribute('content');
    expect(await content('og:title')).toBe('Frame');
    expect(await content('og:description')).toBe('Tweak the motion in the actual component');
    expect(await content('og:url')).toBe('https://www.qendrimbeka.com/projects/frame/');
    expect(await content('og:image')).toBe('https://www.qendrimbeka.com/projects/frame/og.png');
    expect(await page.locator('meta[name="twitter:card"]').getAttribute('content')).toBe('summary_large_image');
    expect(await page.locator('meta[name="twitter:image"]').getAttribute('content')).toBe('https://www.qendrimbeka.com/projects/frame/og.png');
    const card = await request.get(new URL('og.png', SITE).href);
    expect(card.ok()).toBe(true);
    const png = await card.body();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    const icon = await request.get(new URL(await page.locator('link[rel=icon]').getAttribute('href') as string, SITE).href);
    expect(icon.ok()).toBe(true);
    expect(await icon.text()).toContain('<svg');
  });
});

test('the second copy fits a small phone, with nothing to scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const query of ['?c=sheet', '']) {
    await openAtRest(page, query);
    await page.locator('#race').click();
    const copy = page.locator('#rival [data-frame-root]');
    await expect(copy).toBeVisible();
    await copy.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(copy).toBeInViewport({ ratio: 1 });
    expect((await copy.boundingBox())!.height).toBeLessThan(568);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
});

test.describe('what a visitor takes away', () => {
  test('the spring copies as a Frame curve and as CSS the browser accepts', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Reading the clipboard back needs a permission only Chromium grants.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAtRest(page);
    await openTune(page);
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

  test('the address keeps the motion, and a copied link restores it', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAtRest(page);
    await openTune(page);
    await page.getByRole('button', { name: 'Lively' }).click();
    await page.getByRole('button', { name: 'Finish first' }).click();
    const handle = marker(page);
    await handle.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '135');
    await expect.poll(() => page.url()).toContain('k=520&d=20&r=queue&at=135');
    if (browserName === 'chromium') {
      await page.getByRole('button', { name: 'Copy a link to this motion and this take' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    }

    await page.goto(page.url());
    await expect(page.locator('.plot .line-take')).toBeVisible();
    await openTune(page);
    await expect(page.getByRole('button', { name: 'Lively' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Finish first' })).toHaveAttribute('aria-pressed', 'true');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '135');

    // A plain visit keeps a plain address, and nonsense in one is ignored.
    await page.getByRole('button', { name: 'Reset motion' }).click();
    await marker(page).focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await openAtRest(page, '?c=nothing&k=99999&d=abc&r=explode&at=-4&take=nothing&t=%20zz');
    await openTune(page);
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
      const seekHandle = page.getByRole('slider', { name: 'Moment on the speed strip' });
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
    // The plate is a drawing, not a motion, so it is all there.
    expect(await plateInk(page)).toBeGreaterThan(10_000);
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
      await expect(page.locator('.live [data-frame-root]')).toBeInViewport({ ratio: 1 });
      if (width > 767 || width === 390) await expect(page.locator('.plot')).toBeInViewport({ ratio: 1 });
      // The trace never slides under the component it is tracing.
      const component = (await page.locator('.live [data-frame-root]').boundingBox())!;
      const plot = (await page.locator('.plot').boundingBox())!;
      expect(plot.x >= component.x + component.width || plot.y >= component.y + component.height).toBe(true);
    }
    await page.goto(SITE);
    await expect(editExpense(page)).toBeInViewport({ ratio: 1 });
    await expect(surface(page)).toBeInViewport({ ratio: 1 });
  });
}
