import { readFileSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import { rk4Path, type Leg } from '../support/rk4';
import { SCRIPTS } from '../support/scripts';
import { compare, runScript, sampleTimes, type Reading } from '../support/sync';

const STUDIO = 'http://localhost:5172/?clock=manual';
const CONSUMER = 'http://localhost:5182/?clock=manual';

async function play(browser: Browser, url: string, scope: string, name: string, times: number[], reduced = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto(url);
  await page.waitForSelector('[data-frame-root]');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-frame-root]');
  const result = await runScript(page, scope, SCRIPTS.find((s) => s.name === name)!.steps, times);
  await page.close();
  return result;
}

for (const script of SCRIPTS) {
  test(`studio and export agree: ${script.name}`, async ({ browser }) => {
    const times = sampleTimes(script.endMs, 16.667, 11);
    const a = await play(browser, STUDIO, '.stage-live', script.name, times);
    const b = await play(browser, CONSUMER, '#root', script.name, times);
    const result = compare(a, b);
    expect(result.missing).toEqual([]);
    expect(result.compared).toBeGreaterThan(100);
    expect(result.geometryPx).toBeLessThanOrEqual(0.5);
    expect(result.opacity).toBeLessThanOrEqual(0.01);
    expect(result.clipPx).toBeLessThanOrEqual(0.5);
  });
}

test('reduced motion agrees and has no travel', async ({ browser }) => {
  const times = sampleTimes(800, 16.667, 3);
  const a = await play(browser, STUDIO, '.stage-live', 'reversal', times, true);
  const b = await play(browser, CONSUMER, '#root', 'reversal', times, true);
  const result = compare(a, b);
  expect(result.geometryPx).toBeLessThanOrEqual(0.5);
  expect(result.opacity).toBeLessThanOrEqual(0.01);
  // Only two heights ever appear: the two endpoints.
  const heights = new Set(b.map((r) => Math.round(r.targets.surface!.height)));
  expect(heights.size).toBeLessThanOrEqual(2);
});

test('the same input gives the same result however frames are spaced', async ({ browser }) => {
  const dense = sampleTimes(1000, 8, 21);
  const sparse = dense.filter((_, i) => i % 13 === 0);
  const a = await play(browser, CONSUMER, '#root', 'reversal', dense);
  const b = await play(browser, CONSUMER, '#root', 'reversal', sparse);
  const denseAtSparse = a.filter((r) => sparse.includes(r.atMs));
  const result = compare(denseAtSparse, b);
  expect(result.compared).toBeGreaterThan(20);
  expect(result.geometryPx).toBe(0);
  expect(result.opacity).toBe(0);
});

test('real geometry matches an independent numerical solution of the physics', async ({ browser }) => {
  const spec = JSON.parse(readFileSync('fixtures/inspector/inspector.frame.json', 'utf8')).spec;
  const open = spec.transitions.find((t: any) => t.id === 'open');
  const cancelRule = open.interruptions.find((r: any) => r.command === 'cancel').curve;
  const times = sampleTimes(1000, 16.667, 5);
  const readings: Reading[] = await play(browser, CONSUMER, '#root', 'reversal', times);

  // The physics know only the two endpoints, measured here at rest, and the spec's numbers.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:5182/');
  const height = () => page.locator('[data-frame-target=surface]').evaluate((e) => e.getBoundingClientRect().height);
  const compact = await height();
  await page.getByRole('button', { name: 'Edit expense' }).click();
  await page.waitForTimeout(900);
  const editing = await height();
  await page.close();

  const legs: Leg[] = [
    { atMs: 100, to: editing, ...open.timing.curve },
    { atMs: 230, to: compact, ...cancelRule },
  ];
  const expected = rk4Path(compact, legs, readings.map((r) => r.atMs));
  let worst = 0;
  readings.forEach((r, i) => {
    const got = r.targets.surface!.height;
    worst = Math.max(worst, Math.abs(got - expected[i]!));
  });
  // 0.1 px is the settle snap, and drawing rounds to 0.001 px.
  expect(worst).toBeLessThan(0.11);
});
