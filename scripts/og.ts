/**
 * Draws the share card, site/public/og.png, from the built page's own art.
 * It serves dist/site, asks the page for the plate and trace of its Throw and catch example, and
 * sets that under the name and the sentence. Build first, then run this, then build again so the
 * card is in the output.
 *   node --experimental-strip-types --no-warnings scripts/og.ts
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.FRAME_CAPTURE_PORT ?? 5320);
const base = `http://localhost:${PORT}/`;
const out = resolve(process.argv[2] ?? 'site/public/og.png');
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', 'dist/site', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const font = (file: string) => readFileSync(resolve('site/public/fonts', file)).toString('base64');

try {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      await wait(50);
    }
  }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
  await page.goto(`${base}?take=throw-and-catch&capture`);
  await page.waitForSelector('.plot .line-take');
  await page.evaluate(() => document.fonts.ready);
  const art = await page.evaluate(() => (window as unknown as { __frameArt: (w: number, h: number, unit: number) => Promise<string | null> }).__frameArt(2112, 640, 5));
  if (!art) throw new Error('The page did not draw its art.');

  const card = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await card.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: 'Geist Serif'; src: url(data:font/woff2;base64,${font('GeistSerif-Regular.woff2')}) format('woff2'); }
    html, body { margin: 0; }
    body { width: 1200px; height: 630px; background: #ffffff; color: #111511; font-family: 'Geist Serif', serif; -webkit-font-smoothing: antialiased; }
    h1 { position: absolute; left: 72px; top: 44px; margin: 0; font-weight: 400; font-size: 128px; line-height: 132px; letter-spacing: -0.035em; }
    p { position: absolute; left: 76px; top: 184px; margin: 0; font-size: 42px; line-height: 50px; letter-spacing: -0.012em; color: #444944; }
    img { position: absolute; left: 72px; top: 270px; width: 1056px; height: 320px; }
  </style><h1>Frame</h1><p>Tweak the motion in the actual component</p><img alt="" src="${art}">`);
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: out });
  await browser.close();
  console.log(`Share card written to ${out}`);
} finally {
  process.kill(-server.pid!);
}
