import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { compare, runScript, sampleTimes } from '../support/sync';

/**
 * The release criterion from start to finish, as one run. A clean app, whose only link to Frame is
 * the packed tarball, registers a new component. Everything then happens through the real UI.
 */
const DEV_PORT = 5192;
const PREVIEW_PORT = 5193;
const evidence = resolve('evidence/release-run');
const app = mkdtempSync(join(tmpdir(), 'frame-receipt-'));
let dev: ChildProcess;
let preview: ChildProcess;
const log: { step: string; at: string; detail?: unknown }[] = [];
const note = (step: string, detail?: unknown) => log.push({ step, at: new Date().toISOString(), detail });
const shot = (page: Page, name: string) => page.screenshot({ path: join(evidence, name) });

async function waitForPort(port: number) {
  for (let i = 0; i < 300; i += 1) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Port ${port} never came up.`);
}

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async () => {
  rmSync(evidence, { recursive: true, force: true });
  mkdirSync(evidence, { recursive: true });
  execFileSync('node', ['scripts/receipt-consumer.mjs', app], { stdio: 'pipe' });
  note('clean app created with the tarball', { packages: Object.keys(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).devDependencies) });
  dev = spawn('pnpm', ['exec', 'frame', 'dev', 'src/frame.registrations.tsx', '--port', String(DEV_PORT)], { cwd: app, stdio: 'ignore', detached: true });
  await waitForPort(DEV_PORT);
});

test.afterAll(async () => {
  for (const child of [dev, preview]) if (child?.pid) process.kill(-child.pid);
  writeFileSync(join(evidence, 'run.json'), `${JSON.stringify({ criterion: 'register, author three states, interrupt, save, reopen, export, run in a clean consumer', log }, null, 2)}\n`);
  rmSync(app, { recursive: true, force: true });
});

test('from registration to a working export in a clean app', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const studio = `http://localhost:${DEV_PORT}/`;
  await page.goto(studio);
  await expect(page.locator('.stage-live').getByText('Harbour Fuel')).toBeVisible();
  note('component registered from the clean app is live in the studio');

  // Author all three states and the transitions between them.
  await page.getByRole('button', { name: /^Itemized( Now| Start)?$/ }).click();
  await page.getByLabel('Target', { exact: true }).selectOption('stamp');
  await page.getByLabel('Scale').fill('0.4');
  await page.getByRole('button', { name: /^Disputed( Now| Start)?$/ }).click();
  await page.getByLabel('Target', { exact: true }).selectOption('dispute');
  await page.getByLabel('Y offset').fill('0');
  await page.getByRole('button', { name: /^Folded( Now| Start)?$/ }).click();
  await page.getByLabel('Target', { exact: true }).selectOption('lines');
  await page.getByLabel('Y offset').fill('-10');
  await page.getByRole('button', { name: /Folded to Itemized/ }).click();
  await page.getByLabel('Stiffness').fill('520');
  await page.getByLabel('Damping').fill('30');
  await page.getByRole('button', { name: 'Add rule' }).click();
  const rule = page.locator('[data-rule=unfold]');
  await rule.getByLabel('Command').selectOption('fold');
  await page.locator('[data-rule=fold]').getByLabel('Use its own curve').check();
  await page.getByRole('button', { name: /Disputed to Itemized/ }).click();
  await page.getByRole('button', { name: 'Firm' }).click();
  note('authored three states and an interruption rule');

  // Use it and interrupt it.
  const live = page.locator('.stage-live');
  await live.getByRole('button', { name: /Harbour Fuel/ }).click();
  await page.waitForTimeout(110);
  await live.getByRole('button', { name: /Harbour Fuel/ }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.marker')).toHaveCount(2);
  await shot(page, '1-take-inspected.png');
  note('interrupted a transition and inspected the take');

  // Save, clear everything, reopen.
  const [saved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save project' }).click()]);
  const projectPath = join(app, 'receipt.frame.json');
  writeFileSync(projectPath, readFileSync(await saved.path()));
  const project = JSON.parse(readFileSync(projectPath, 'utf8'));
  await page.evaluate(() => localStorage.clear());
  await page.goto(studio);
  await page.getByTestId('open-file').setInputFiles(projectPath);
  await expect(page.getByTestId('save-status')).toContainText('Opened');
  await expect(page.locator('.marker')).toHaveCount(2);
  await page.getByRole('button', { name: /Folded to Itemized/ }).click();
  await expect(page.getByLabel('Stiffness').first()).toHaveValue('520');
  note('saved the project file, cleared storage and reopened it', { sha256: createHash('sha256').update(readFileSync(projectPath)).digest('hex') });
  cpSync(projectPath, join(evidence, 'receipt.frame.json'));

  // Export through the UI and drop the folder into the clean app.
  await page.getByRole('button', { name: 'Export' }).click();
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download zip' }).click()]);
  const zipPath = join(app, 'export.zip');
  writeFileSync(zipPath, readFileSync(await zip.path()));
  execFileSync('unzip', ['-q', zipPath, '-d', join(app, 'unzipped')]);
  const folder = join(app, 'unzipped', readdirSync(join(app, 'unzipped'))[0]!);
  cpSync(folder, join(app, 'src/motion'), { recursive: true });
  execFileSync('pnpm', ['run', 'build'], { cwd: app, stdio: 'pipe' });
  const bundle = readdirSync(join(app, 'dist/assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(app, 'dist/assets', f), 'utf8')).join('');
  for (const editorOnly of ['Interrupt here', 'Save project', 'parseMotionSpec', 'createZip', 'localStorage']) {
    expect(bundle.includes(editorOnly), `bundle holds ${editorOnly}`).toBe(false);
  }
  note('exported from the UI, built in the clean app, and found no editor code in the bundle', { files: readdirSync(join(app, 'src/motion')) });

  // Use the export.
  preview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: app, stdio: 'ignore', detached: true });
  await waitForPort(PREVIEW_PORT);
  const consumer = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await consumer.goto(`http://localhost:${PREVIEW_PORT}/`);
  await consumer.getByRole('button', { name: /Harbour Fuel/ }).click();
  await expect(consumer.getByRole('button', { name: 'Dispute this charge' })).toBeVisible();
  await consumer.getByRole('button', { name: 'Dispute this charge' }).click();
  await consumer.getByLabel('What went wrong?').fill('Charged twice');
  await consumer.getByRole('button', { name: 'Withdraw' }).click();
  await consumer.getByRole('button', { name: 'Dispute this charge' }).click();
  await expect(consumer.getByLabel('What went wrong?')).toHaveValue('Charged twice');
  await expect(consumer.getByLabel('What went wrong?')).toBeFocused();
  await consumer.waitForTimeout(800);
  await consumer.screenshot({ path: join(evidence, '2-export-running.png') });
  note('used the export: unfolded, disputed, typed, withdrew and came back with the text and focus intact');

  // Same input, same times, in the studio and in the export.
  const script = [
    { atMs: 100, click: 'Harbour Fuel$62.15' },
    { atMs: 210, click: 'Harbour Fuel$62.15' },
    { atMs: 280, click: 'Harbour Fuel$62.15' },
  ];
  const times = sampleTimes(1100, 16.667, 7);
  const a = await page.context().newPage();
  await a.goto(`${studio}?clock=manual`);
  await a.getByTestId('open-file').setInputFiles(projectPath);
  await expect(a.getByTestId('save-status')).toContainText('Opened');
  await a.getByRole('button', { name: 'Reset to this state' }).click();
  await expect(a.locator('.mode')).toHaveText('Live');
  const b = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await b.goto(`http://localhost:${PREVIEW_PORT}/?clock=manual`);
  await b.waitForSelector('[data-frame-root]');
  const fromStudio = await runScript(a, '.stage-live', script, times);
  const fromExport = await runScript(b, '#root', script, times);
  const result = compare(fromStudio, fromExport);
  writeFileSync(join(evidence, 'studio-vs-export.json'), `${JSON.stringify({ script, times, result, fromStudio, fromExport })}\n`);
  note('compared studio and export at synchronized samples', result);
  expect(result.missing).toEqual([]);
  expect(result.compared).toBeGreaterThan(200);
  expect(result.geometryPx).toBeLessThanOrEqual(0.5);
  expect(result.opacity).toBeLessThanOrEqual(0.01);
  expect(errors).toEqual([]);
});
