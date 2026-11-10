/**
 * Looks for long tasks on the built project page with the main thread slowed four times.
 * It serves dist/site, drives the page with real input, and prints the longest task Chromium
 * reported during load and during each interaction. A task over 50 ms after load fails the run.
 * This is one lab check on one machine. It is not a frame rate.
 *   node --experimental-strip-types --no-warnings scripts/long-tasks.ts
 */
import { spawn } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';

const PORT = Number(process.env.FRAME_CAPTURE_PORT ?? 5320);
const base = `http://localhost:${PORT}/`;
const LIMIT_MS = 50;
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', 'dist/site', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The longest task since the last call, in milliseconds. */
const longest = (page: Page) =>
  page.evaluate(() => {
    const store = window as unknown as { __tasks: number[] };
    const worst = Math.max(0, ...store.__tasks);
    store.__tasks.length = 0;
    return Math.round(worst);
  });

async function drag(page: Page, selector: string, dx: number, dy: number, steps = 24, pauseMs = 12, hold = false) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await wait(pauseMs);
  }
  if (!hold) await page.mouse.up();
}

let failed = false;
try {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      await wait(50);
    }
  }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const store = window as unknown as { __tasks: number[] };
    store.__tasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.__tasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(base);
  await page.waitForSelector('.plot .line-take');
  await wait(2600);
  const rows: [string, number][] = [['load and the example playing once', await longest(page)]];
  const step = async (name: string, run: () => Promise<void>) => {
    await run();
    await wait(900);
    rows.push([name, await longest(page)]);
  };

  await step('dragging the card open by hand and letting go', () => drag(page, '#grab', 0, 150));
  await step('pressing Cancel, catching the card mid flight and throwing it open again', async () => {
    await page.locator('#back').click();
    await wait(120);
    await drag(page, '.live .fx-summary', 0, 90, 14);
  });
  await step('dragging the interruption', async () => {
    await page.locator('[data-take=reverse]').click();
    await wait(900);
    await drag(page, '.marker', 140, 0);
  });
  await step('scrubbing the take', () => drag(page, '.seek', 300, 0));
  await step('replaying', () => page.locator('#replay').click());
  await step('playing each example', async () => {
    for (const id of ['double-tap', 'late-cancel', 'throw-and-catch', 'slow-pull']) {
      await page.locator(`[data-take=${id}]`).click();
      await wait(1100);
    }
  });
  await step('opening Tune and dragging the spring', async () => {
    await page.locator('[data-take=reverse]').click();
    await page.locator('#tune').click();
    await wait(600);
    await drag(page, '.spring-handle', 40, 30);
  });
  await step('racing', async () => {
    await page.locator('#race').click();
    await wait(1400);
  });
  await step('exporting', async () => {
    await page.locator('#export').click();
    await wait(1600);
  });
  await step('saving the plate', async () => {
    await page.locator('#export').click();
    await Promise.all([page.waitForEvent('download'), page.locator('#save-plate').click()]);
  });
  await step('scrolling to the essay and moving the interruption in its figures', async () => {
    await page.locator('.mount[data-figure=rules]').scrollIntoViewIfNeeded();
    await page.waitForSelector('.rule canvas');
    await wait(500);
    await page.locator('#rules-delay').focus();
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('ArrowRight');
      await wait(30);
    }
    await page.locator('.mount[data-figure=css]').scrollIntoViewIfNeeded();
    await drag(page, '.css-half svg', 120, 0, 20, 12);
  });
  await browser.close();

  for (const [name, ms] of rows) console.log(`${String(ms).padStart(4)} ms  ${name}`);
  failed = rows.slice(1).some(([, ms]) => ms > LIMIT_MS);
  console.log(failed ? `A task ran longer than ${LIMIT_MS} ms during an interaction.` : `No task ran longer than ${LIMIT_MS} ms during an interaction.`);
} finally {
  process.kill(-server.pid!);
}
process.exit(failed ? 1 : 0);
