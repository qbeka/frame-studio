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

const PORT = 5320;
const base = `http://localhost:${PORT}/`;
const media = resolve('docs/media');
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', 'dist/site/studio', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
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

async function interrupt(page: Page) {
  await press(page, page.locator('.stage-live').getByRole('button', { name: 'Edit expense' }));
  await wait(120);
  await press(page, page.locator('.stage-live').getByRole('button', { name: 'Cancel' }));
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

async function record(name: string, script: (page: Page) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'frame-capture-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector('[data-frame-root]');
  await page.evaluate(() => document.fonts.ready);
  await script(page);
  await context.close();
  await browser.close();
  const webm = join(dir, readdirSync(dir)[0]!);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(media, `${name}.mp4`)]);
  rmSync(dir, { recursive: true, force: true });
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
  await wait(120);
  await press(page, page.getByRole('button', { name: 'Cancel' }));
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
  await wait(120);
  await press(page, page.getByRole('button', { name: 'Cancel' }));
  await say('Same input, same times, compared by geometry in three browser engines', 6000);
  await say('The results and their limits are in docs/REPORT.md', 4000);
}

async function stills() {
  const browser = await chromium.launch();
  const shot = async (w: number, h: number, name: string, prepare?: (page: Page) => Promise<void>, fullPage = false) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
    await page.goto(base);
    await page.waitForSelector('[data-frame-root]');
    await page.evaluate(() => document.fonts.ready);
    await prepare?.(page);
    await page.screenshot({ path: join(media, name), fullPage });
  };
  const inspected = async (page: Page) => {
    await page.getByRole('button', { name: /play an example/ }).click();
    await page.waitForTimeout(1300);
    const box = (await page.locator('.ribbon-svg').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + 40);
    await page.waitForTimeout(150);
  };
  await shot(1280, 640, 'cover.png', inspected);
  await shot(1440, 900, 'studio.png', inspected);
  await shot(390, 844, 'mobile.png', inspected);
  await shot(1440, 900, 'empty.png');
  await browser.close();
}

const only = process.argv[2];
try {
  if (!only || only === 'stills') await stills();
  if (!only || only === 'signature') await record('signature', signature);
  if (!only || only === 'walkthrough') await record('walkthrough', walkthrough);
} finally {
  process.kill(-server.pid!);
}
