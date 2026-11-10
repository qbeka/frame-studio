/**
 * Captures the README media from the real production build, with real input.
 * The cursor dot and captions are drawn only inside these recordings.
 *   node --experimental-strip-types --no-warnings scripts/capture.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const PORT = Number(process.env.FRAME_CAPTURE_PORT ?? 5320);
const base = `http://localhost:${PORT}/`;
/** The studio opens on its example take. The recordings make their own, so they start empty. */
const studio = `${base}studio/`;
const media = resolve('docs/media');
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', 'dist/site', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i += 1) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    await wait(50);
  }
}

const overlay = () => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99;width:14px;height:14px;margin:-7px;border-radius:50%;background:#1d3a2a;opacity:.75;pointer-events:none;left:-20px;top:-20px';
    const note = document.createElement('div');
    note.style.cssText = 'position:fixed;z-index:99;left:50%;top:58px;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:#121412;color:#fff;font:14px ui-sans-serif,system-ui;white-space:nowrap;pointer-events:none;opacity:0';
    document.body.append(dot, note);
    addEventListener('mousemove', (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    });
    (window as any).__caption = (text: string) => {
      note.textContent = text;
      note.style.opacity = text ? '1' : '0';
    };
  });
};

const caption = (page: Page, text: string) => page.evaluate((t) => (window as any).__caption(t), text);

async function moveTo(page: Page, locator: ReturnType<Page['locator']>) {
  const box = (await locator.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y, { steps: 18 });
  return point;
}

async function press(page: Page, locator: ReturnType<Page['locator']>) {
  await moveTo(page, locator);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Opens the card and cancels it mid flight. The cancel is the Escape key, because moving the
 * pointer to a button that has only just appeared takes longer than the transition does.
 */
async function interrupt(page: Page) {
  await press(page, page.locator('.stage-live').getByRole('button', { name: 'Edit expense' }));
  await wait(110);
  await page.keyboard.press('Escape');
  await wait(900);
}

async function dragMarker(page: Page, by: number) {
  const point = await moveTo(page, page.locator('.marker').nth(1));
  await page.mouse.down();
  await page.mouse.move(point.x + by, point.y, { steps: 50 });
  await page.mouse.up();
}

async function scrub(page: Page) {
  const box = (await page.locator('.ribbon-svg').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.04, box.y + 30, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + 30, { steps: 90 });
  await page.mouse.up();
}

async function record(name: string, script: (page: Page) => Promise<void>, url = `${studio}?take=none`) {
  const dir = mkdtempSync(join(tmpdir(), 'frame-capture-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-frame-root]');
  await page.evaluate(() => document.fonts.ready);
  await script(page);
  await context.close();
  await browser.close();
  const webm = join(dir, readdirSync(dir)[0]!);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(media, `${name}.mp4`)]);
  rmSync(dir, { recursive: true, force: true });
}

/** Drags from a point straight down or up, through `shape`, which maps time to distance. */
async function pull(page: Page, from: { x: number; y: number }, dy: number, ms: number, shape: (x: number) => number, release = true) {
  await page.mouse.move(from.x, from.y, { steps: 12 });
  await page.mouse.down();
  await drive(page, from, dy, ms, shape);
  if (release) await page.mouse.up();
}

/** Moves a pointer that is already down. By the clock, not by a count of moves: a browser that is recording answers each move slowly. */
async function drive(page: Page, from: { x: number; y: number }, dy: number, ms: number, shape: (x: number) => number) {
  const started = Date.now();
  for (;;) {
    const x = Math.min(1, (Date.now() - started) / ms);
    await page.mouse.move(from.x, from.y + dy * shape(x));
    if (x >= 1) break;
  }
}

const middle = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const ease = (x: number) => x * x * (3 - 2 * x);
const flick = (x: number) => x * x;

/** The project page, driven by hand: a slow pull, a throw, a catch mid flight and a throw back. */
async function hand(page: Page, say: (text: string) => Promise<void> = (text) => caption(page, text)) {
  await page.waitForSelector('.plot .line-take');
  await wait(1900);
  await say('Take hold of the real component and pull');
  await pull(page, await middle(page, '#grab'), 96, 900, ease, false);
  await wait(450);
  await page.mouse.up();
  await wait(1100);
  await say('Throw it, and the spring starts from your speed');
  const summary = await middle(page, '.live .fx-summary');
  const card = { x: summary.x - 60, y: summary.y + 16 };
  await pull(page, await middle(page, '#grab'), 120, 150, flick);
  await wait(60);
  // The pointer jumps to the catch: the card is only in the air for a moment.
  await page.mouse.move(card.x, card.y);
  await page.mouse.down();
  await say('Catch it on the way and throw it back');
  await drive(page, card, -30, 260, ease);
  await drive(page, { x: card.x, y: card.y - 30 }, -28, 110, flick);
  await page.mouse.up();
  await wait(1500);
  await say('Every take prints a plate');
  await page.mouse.move(card.x + 260, card.y + 440, { steps: 14 });
  await wait(900);
}

async function signature(page: Page) {
  await caption(page, 'Use the real component, and interrupt it');
  await wait(1200);
  await interrupt(page);
  await press(page, page.getByRole('button', { name: 'Pause', exact: true }));
  await caption(page, 'The solid line is what happened. Dotted is the path without the cancel.');
  await wait(2200);
  await caption(page, 'Drag the interruption. The component follows.');
  await dragMarker(page, 120);
  await wait(500);
  await dragMarker(page, -70);
  await caption(page, 'Change the spring. The same take reruns.');
  await wait(600);
  await press(page, page.getByRole('button', { name: 'Lively' }).first());
  await wait(1300);
  await caption(page, 'Scrub the exact sequence');
  await scrub(page);
  await wait(500);
  await caption(page, 'Export it. This is a separate production build.');
  await press(page, page.getByRole('button', { name: 'Export' }));
  await wait(1400);
  await press(page, page.getByRole('link', { name: /built export/ }));
  await page.waitForSelector('[data-frame-root]');
  await wait(700);
  await press(page, page.getByRole('button', { name: 'Edit expense' }));
  await wait(110);
  await page.keyboard.press('Escape');
  await wait(1100);
}

async function walkthrough(page: Page) {
  const say = async (text: string, ms: number) => {
    await caption(page, text);
    await wait(ms);
  };
  await say('Frame edits what happens when a transition is interrupted', 4000);
  await say('This is a registered React component, in native document flow', 4000);
  await interrupt(page);
  await say('Frame recorded named commands, with the measured layout at each', 4000);
  await press(page, page.getByRole('button', { name: 'Pause', exact: true }));
  await say('A take. Every value is a closed-form function of time.', 5000);
  await say('A retarget starts a new spring from the current position and speed', 5000);
  await moveTo(page, page.locator('.readout'));
  await say('Position, velocity and target at the playhead', 4000);
  await scrub(page);
  await say('Scrubbing replays commands and props, so it is the exact sequence', 4000);
  await say('Drag the cancel to a new moment', 2000);
  await dragMarker(page, 130);
  await say('The rule is what is exported, not this one path', 5000);
  await moveTo(page, page.getByRole('heading', { name: 'When interrupted' }));
  await say('Rules can retarget, queue or ignore, with their own curve', 5000);
  await press(page, page.getByRole('button', { name: 'Firm', exact: true }).first());
  await say('Text is never scaled. Surfaces and clips carry the size change.', 5000);
  await press(page, page.getByRole('button', { name: 'Export' }));
  await say('The export is readable TypeScript with no dependency on Frame', 5000);
  await press(page, page.getByRole('link', { name: /built export/ }));
  await page.waitForSelector('[data-frame-root]');
  await press(page, page.getByRole('button', { name: 'Edit expense' }));
  await wait(110);
  await page.keyboard.press('Escape');
  await say('Same input, same times, compared by geometry in three browser engines', 6000);
  await say('The results and their limits are in docs/REPORT.md', 4000);
}

async function stills() {
  const browser = await chromium.launch();
  const shot = async (url: string, w: number, h: number, name: string, prepare?: (page: Page) => Promise<void>, fullPage = false) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
    await page.goto(url);
    await page.waitForSelector('[data-frame-root]');
    await page.evaluate(() => document.fonts.ready);
    await prepare?.(page);
    await page.screenshot({ path: join(media, name), fullPage });
  };
  // The studio as it opens: the example take, held at its interruption.
  const opened = async (page: Page) => {
    await page.waitForSelector('.ribbon-ghost');
    await page.waitForTimeout(300);
  };
  // The project page with the card thrown open, caught on the way and held there by hand.
  const held = async (page: Page) => {
    await page.waitForSelector('.plot .line-take');
    await page.locator('#take-note').click();
    await wait(300);
    const summary = await middle(page, '.live .fx-summary');
    const card = { x: summary.x - 60, y: summary.y + 16 };
    await pull(page, await middle(page, '#grab'), 120, 150, flick);
    await wait(60);
    await page.mouse.move(card.x, card.y);
    await page.mouse.down();
    await drive(page, card, -34, 260, ease);
    await wait(120);
  };
  await shot(base, 1440, 800, 'cover.png', held);
  await shot(studio, 1440, 900, 'studio.png', opened);
  await shot(studio, 390, 844, 'mobile.png', opened);
  await shot(`${studio}?take=none`, 1440, 900, 'empty.png');
  await browser.close();
}

const only = process.argv[2];
try {
  if (!only || only === 'stills') await stills();
  if (!only || only === 'hand') await record('hand', (page) => hand(page), base);
  if (!only || only === 'signature') await record('signature', signature);
  if (!only || only === 'walkthrough') await record('walkthrough', walkthrough);
} finally {
  process.kill(-server.pid!);
}
