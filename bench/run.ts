/**
 * Runs the measurements in bench/PROTOCOL.md and writes raw results and a manifest per experiment.
 *   pnpm bench          the full protocol
 *   pnpm bench:smoke    one run of each, to check the harness works. Its numbers are not results.
 *   pnpm bench -- --only fidelity,controls
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, type Browser, type Page } from '@playwright/test';
import { compare, runScript, sampleTimes, type Reading } from '../tests/support/sync.ts';
import { SCRIPTS } from '../tests/support/scripts.ts';
import { rk4Path } from '../tests/support/rk4.ts';
import { manifest, median, percentile, saveRun } from './lib/manifest.ts';

const smoke = process.argv.includes('--smoke');
const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]! : null;
const wanted = (name: string) => (onlyArg ? onlyArg.split(',').includes(name) : true);
const RUNS = smoke ? 1 : 5;
const outName = (name: string) => (smoke ? `smoke/${name}` : name);
const repo = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'frame-bench-'));
const children: ChildProcess[] = [];
const run = (command: string, args: string[], cwd = repo) => execFileSync(command, args, { cwd, stdio: 'pipe' });
const VIEWPORT = { width: 1440, height: 900 };

function serve(dir: string, port: number) {
  const child = spawn('pnpm', ['--dir', repo, 'exec', 'vite', 'preview', '--outDir', dir, '--port', String(port), '--strictPort'], {
    cwd: repo,
    stdio: 'ignore',
    detached: true,
  });
  children.push(child);
  return waitFor(port);
}

async function waitFor(port: number) {
  for (let i = 0; i < 400; i += 1) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Port ${port} did not start.`);
}

function stop() {
  for (const child of children) {
    try {
      process.kill(-child.pid!);
    } catch {
      // Already gone.
    }
  }
  children.length = 0;
}

const studioBuild = (registrations: string, name: string) => {
  const out = join(scratch, name);
  run('node', ['packages/studio/cli/frame.mjs', 'build-demo', registrations, '--out', out]);
  return out;
};

const consumerBuild = (name: string) => {
  const out = join(scratch, name);
  run('node', ['scripts/consumer.mjs', 'vite', '--out', out]);
  return out;
};

async function open(browser: Browser, url: string, dpr: number, reduced = false) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-frame-root]');
  return { page, context };
}

async function playScript(browser: Browser, url: string, scope: string, script: (typeof SCRIPTS)[number], times: number[], dpr: number) {
  const { page, context } = await open(browser, url, dpr);
  const readings = await runScript(page, scope, script.steps, times);
  await context.close();
  return readings;
}

const STUDIO_PORT = 5301;
const CONSUMER_PORT = 5302;
const studioUrl = `http://localhost:${STUDIO_PORT}/?clock=manual`;
const consumerUrl = `http://localhost:${CONSUMER_PORT}/?clock=manual`;

async function fidelity() {
  const studio = studioBuild('fixtures/inspector/frame.registrations.tsx', 'studio');
  const consumer = consumerBuild('consumer');
  await serve(studio, STUDIO_PORT);
  await serve(join(consumer, 'dist'), CONSUMER_PORT);
  const rows: unknown[] = [];
  const raw: Record<string, unknown> = {};
  for (let r = 0; r < RUNS; r += 1) {
    const browser = await chromium.launch();
    for (const dpr of [1, 2]) {
      for (const script of SCRIPTS) {
        const seed = 100 + r;
        const times = sampleTimes(script.endMs, 16.667, seed);
        const a = await playScript(browser, studioUrl, '.stage-live', script, times, dpr);
        const b = await playScript(browser, consumerUrl, '#root', script, times, dpr);
        const result = compare(a, b);
        rows.push({ run: r, dpr, script: script.name, seed, samples: times.length, ...result });
        raw[`run${r}-dpr${dpr}-${script.name}`] = { times, studio: a, export: b };
      }
    }
    const version = browser.version();
    await browser.close();
    (raw as any).browserVersion = version;
  }
  stop();
  const meta = manifest({ experiment: 'fidelity', runs: RUNS, viewport: VIEWPORT, deviceScales: [1, 2], browser: (raw as any).browserVersion, warmup: 'none, each script starts from a fresh page', exclusions: 'none', seed: '100 + run index' });
  saveRun(outName('fidelity'), meta, { rows, ...(smoke ? {} : raw) });
  return rows as { geometryPx: number; opacity: number; clipPx: number; compared: number; missing: string[] }[];
}

/** Compares real geometry to RK4, which shares no code with the runtime. */
async function reference() {
  const spec = JSON.parse(readFileSync('fixtures/inspector/inspector.frame.json', 'utf8')).spec;
  const opened = spec.transitions.find((t: any) => t.id === 'open');
  const cancel = opened.interruptions.find((x: any) => x.command === 'cancel').curve;
  const consumer = consumerBuild('consumer-ref');
  await serve(join(consumer, 'dist'), CONSUMER_PORT);
  const rows: unknown[] = [];
  for (let r = 0; r < RUNS; r += 1) {
    const browser = await chromium.launch();
    const script = SCRIPTS[0]!;
    const times = sampleTimes(script.endMs, 16.667, 200 + r);
    const readings: Reading[] = await playScript(browser, consumerUrl, '#root', script, times, 1);
    const { page, context } = await open(browser, consumerUrl.replace('?clock=manual', ''), 1);
    const height = () => page.locator('[data-frame-target=surface]').evaluate((e) => e.getBoundingClientRect().height);
    const compact = await height();
    await page.getByRole('button', { name: 'Edit expense' }).click();
    await page.waitForTimeout(900);
    const editing = await height();
    await context.close();
    const expected = rk4Path(compact, [{ atMs: 100, to: editing, ...opened.timing.curve }, { atMs: 230, to: compact, ...cancel }], readings.map((x) => x.atMs));
    const errors = readings.map((x, i) => Math.abs(x.targets.surface!.height - expected[i]!));
    rows.push({ run: r, samples: errors.length, worstPx: Math.max(...errors), medianPx: median(errors) });
    await browser.close();
  }
  stop();
  saveRun(outName('reference'), manifest({ experiment: 'reference', runs: RUNS, method: 'RK4 at a 0.05 ms step, against the surface height in the exported consumer', exclusions: 'none' }), { rows });
  return rows as { worstPx: number }[];
}

/** Each fault is written into a clean export. The fidelity check must flag every one. */
const FAULTS: { name: string; file: string; find: string; replace: string }[] = [
  { name: 'velocity dropped on retarget', file: 'channel.ts', find: 'const { position, velocity } = readChannel(channel, startMs);', replace: 'const { position } = readChannel(channel, startMs); const velocity = 0;' },
  { name: 'damping 2 percent high', file: 'spring.ts', find: 'z: damping / (2 * Math.sqrt(stiffness * mass))', replace: 'z: (1.02 * damping) / (2 * Math.sqrt(stiffness * mass))' },
  { name: 'commands 8 ms late', file: 'controller.ts', find: 'dispatch(command, now());', replace: 'dispatch(command, now() + 8);' },
  { name: 'opacity 2 percent low', file: 'dom.ts', find: "element.style.opacity = s.opacity >= 0.9995 ? '' : fixed(Math.max(0, Math.min(1, s.opacity)));\n    if (s.exiting)", replace: "element.style.opacity = s.opacity >= 0.9995 ? '' : fixed(Math.max(0, Math.min(1, s.opacity * 0.98)));\n    if (s.exiting)" },
  { name: 'resize ignored', file: 'controller.ts', find: 'const remeasure = () => this.remeasure();', replace: 'const remeasure = () => {};' },
  { name: 'interruption curve ignored', file: 'timeline.ts', find: 'if (rule?.curve) return { curve: rule.curve, delayMs: 0 };', replace: '' },
  { name: 'exit box sizing removed', file: '../frame.css', find: 'box-sizing: border-box !important;', replace: '' },
];

async function controls() {
  await serve(studioBuild('fixtures/inspector/frame.registrations.tsx', 'studio-controls'), STUDIO_PORT);
  const base = consumerBuild('consumer-controls');
  const browser = await chromium.launch();
  const rows: unknown[] = [];
  const check = async (name: string, dir: string) => {
    await serve(dir, CONSUMER_PORT);
    let geometryPx = 0;
    let opacity = 0;
    let missing = 0;
    for (const script of SCRIPTS) {
      const times = sampleTimes(script.endMs, 16.667, 300);
      const a = await playScript(browser, studioUrl, '.stage-live', script, times, 1);
      const b = await playScript(browser, consumerUrl, '#root', script, times, 1);
      const result = compare(a, b);
      geometryPx = Math.max(geometryPx, result.geometryPx);
      opacity = Math.max(opacity, result.opacity);
      missing += result.missing.length;
    }
    const detected = geometryPx > 0.5 || opacity > 0.01 || missing > 0;
    rows.push({ name, geometryPx, opacity, missing, detected });
    for (const child of children.splice(1)) process.kill(-child.pid!);
    await new Promise((r) => setTimeout(r, 200));
  };
  await check('unmodified export', join(base, 'dist'));
  for (const fault of smoke ? FAULTS.slice(0, 1) : FAULTS) {
    const dir = join(scratch, `fault-${FAULTS.indexOf(fault)}`);
    cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
    const file = join(dir, 'src/motion/runtime', fault.file);
    const source = readFileSync(file, 'utf8');
    if (!source.includes(fault.find)) throw new Error(`Fault "${fault.name}" no longer applies.`);
    writeFileSync(file, source.replace(fault.find, fault.replace));
    run('pnpm', ['exec', 'vite', 'build'], dir);
    await check(fault.name, join(dir, 'dist'));
  }
  await browser.close();
  stop();
  saveRun(outName('controls'), manifest({ experiment: 'controls', faults: FAULTS.map((f) => f.name), rule: 'detected when geometry exceeds 0.5 px, opacity exceeds 0.01, or a target is missing' }), { rows });
  return rows as { name: string; detected: boolean }[];
}

const nextFrame = `new Promise((resolve) => requestAnimationFrame(() => resolve()))`;

async function measureEdits(page: Page, count: number, warmup: number) {
  return page.evaluate(
    async ({ count, warmup, nextFrame }) => {
      const frame = () => (0, eval)(nextFrame) as Promise<void>;
      const input = [...document.querySelectorAll('label')].find((l) => l.textContent === 'Stiffness')!.control as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const slider = document.querySelector('[role=slider]') as HTMLElement;
      const out = { editDom: [] as number[], editFrame: [] as number[], seekDom: [] as number[], seekFrame: [] as number[] };
      const path = document.querySelector('.ribbon-path')!;
      for (let i = 0; i < warmup + count; i += 1) {
        await frame();
        const before = path.getAttribute('d');
        const t0 = performance.now();
        setValue.call(input, String(300 + (i % 2) * 400 + i));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // The clock stops only once the ribbon has really changed, so this cannot undercount
        // by finishing before React commits. A spin of microtasks, then real tasks if needed.
        for (let polls = 0; path.getAttribute('d') === before; polls += 1) {
          if (polls < 200) await Promise.resolve();
          else if (polls < 400) await new Promise((r) => setTimeout(r, 0));
          else throw new Error('An edit did not change the ribbon.');
        }
        const t1 = performance.now();
        await frame();
        const t2 = performance.now();
        if (i >= warmup) {
          out.editDom.push(t1 - t0);
          out.editFrame.push(t2 - t0);
        }
      }
      slider.focus();
      for (let i = 0; i < warmup + count; i += 1) {
        await frame();
        const before = slider.getAttribute('aria-valuenow');
        const t0 = performance.now();
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: i % 20 < 10 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
        for (let polls = 0; slider.getAttribute('aria-valuenow') === before; polls += 1) {
          if (polls < 200) await Promise.resolve();
          else if (polls < 400) await new Promise((r) => setTimeout(r, 0));
          else throw new Error('A seek did not move the playhead.');
        }
        const t1 = performance.now();
        await frame();
        const t2 = performance.now();
        if (i >= warmup) {
          out.seekDom.push(t1 - t0);
          out.seekFrame.push(t2 - t0);
        }
      }
      return out;
    },
    { count, warmup, nextFrame },
  );
}

async function authoring() {
  const build = studioBuild('bench/fixtures/frame.registrations.tsx', 'studio-bench');
  await serve(build, STUDIO_PORT);
  const sizes = [1, 10, 30, 200];
  const rows: any[] = [];
  const raw: Record<string, unknown> = {};
  for (let r = 0; r < RUNS; r += 1) {
    for (const [index, targets] of sizes.entries()) {
      const browser = await chromium.launch();
      const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
      await page.goto(`http://localhost:${STUDIO_PORT}/`);
      await page.locator('select[aria-label=Component]').selectOption({ index });
      const toggle = page.locator('.stage-live').getByRole('button', { name: 'Toggle' });
      await toggle.click();
      await page.waitForTimeout(120);
      await toggle.click();
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Pause' }).click();
      await page.waitForSelector('.ribbon-path', { state: 'attached' });
      const samples = await measureEdits(page, smoke ? 15 : 60, smoke ? 5 : 20);

      await page.getByRole('button', { name: 'Export' }).click();
      const started = Date.now();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download zip' }).click()]);
      await download.path();
      const exportMs = Date.now() - started;
      await browser.close();

      const summary = (list: number[]) => ({ p50: median(list), p95: percentile(list, 95), max: Math.max(...list) });
      rows.push({
        run: r,
        targets,
        stress: targets === 200,
        editDom: summary(samples.editDom),
        editFrame: summary(samples.editFrame),
        seekDom: summary(samples.seekDom),
        seekFrame: summary(samples.seekFrame),
        exportMs,
      });
      raw[`run${r}-targets${targets}`] = samples;
    }
  }
  stop();
  const cliStarted = Date.now();
  run('node', ['packages/studio/cli/frame.mjs', 'export', 'fixtures/inspector/inspector.frame.json', '--out', join(scratch, 'cli-export')]);
  const cliExportMs = Date.now() - cliStarted;
  saveRun(outName('authoring'), manifest({ experiment: 'authoring', runs: RUNS, viewport: VIEWPORT, warmup: smoke ? 5 : 20, samples: smoke ? 15 : 60, cliExportMs, proxy: 'editFrame and seekFrame end on a frame callback, which does not prove a displayed frame' }), { rows, ...(smoke ? {} : raw) });
  return rows;
}

function folderGzip(dir: string, extension: string) {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) bytes += folderGzip(path, extension);
    else if (name.endsWith(extension)) bytes += gzipSync(readFileSync(path), { level: 9 }).length;
  }
  return bytes;
}

const APPS = ['none', 'frame', 'motion', 'motion-lazy'];

function prepareApps() {
  const apps = join(scratch, 'apps');
  cpSync('bench/apps', apps, { recursive: true, filter: (s) => !/node_modules|dist$/.test(s) });
  for (const name of APPS) cpSync('fixtures/inspector/inspector.css', join(apps, name, 'src/inspector.css'));
  run('node', ['packages/studio/cli/frame.mjs', 'export', 'fixtures/inspector/inspector.frame.json', '--out', join(apps, 'frame/src/motion')]);
  run('pnpm', ['install', '--ignore-workspace', '--frozen-lockfile', '--prefer-offline'], apps);
  for (const name of APPS) run('pnpm', ['exec', 'vite', 'build', name, '--config', join(apps, name, 'vite.config.js')], apps);
  return apps;
}

async function size() {
  const apps = prepareApps();
  const measure = (name: string) => ({ jsGzip: folderGzip(join(apps, name, 'dist'), '.js'), cssGzip: folderGzip(join(apps, name, 'dist'), '.css') });
  const none = measure('none');
  const rows = APPS.map((name) => {
    const m = measure(name);
    return { app: name, ...m, jsOverNone: m.jsGzip - none.jsGzip, cssOverNone: m.cssGzip - none.cssGzip };
  });
  saveRun(outName('size'), manifest({ experiment: 'size', method: 'gzip level 9 of vite build output', motion: '14.9.1' }), { rows });
  return rows;
}

async function runtimeCost() {
  const apps = join(scratch, 'apps');
  if (!existsSync(apps)) prepareApps();
  const rows: any[] = [];
  const cycles = smoke ? 4 : 20;
  for (let r = 0; r < RUNS; r += 1) {
    for (const [i, name] of ['frame', 'motion', 'motion-lazy'].entries()) {
      const port = 5310 + i;
      await serve(join(apps, name, 'dist'), port);
      const browser = await chromium.launch();
      const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
      await page.goto(`http://localhost:${port}/`);
      await page.waitForSelector('.fx-button');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const read = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      // Same task check: the panel must really turn around mid flight in every app, or the
      // comparison would be meaningless. Height is sampled on frames during one reversal.
      const reversal = await page.evaluate(async () => {
        const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;
        const box = () => (document.querySelector('[data-frame-target=surface]') ?? document.querySelector('.fx-inspector'))!.getBoundingClientRect().height;
        const rest = box();
        button('Edit expense').click();
        const start = performance.now();
        const seen: number[] = [];
        let cancelled = false;
        await new Promise<void>((resolve) => {
          const loop = () => {
            seen.push(box());
            if (!cancelled && performance.now() - start > 120) {
              cancelled = true;
              button('Cancel').click();
            }
            if (performance.now() - start < 800) requestAnimationFrame(loop);
            else resolve();
          };
          requestAnimationFrame(loop);
        });
        return { rest, peak: Math.max(...seen), end: seen[seen.length - 1]! };
      });
      const before = await read();
      await page.evaluate(async (count) => {
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;
        for (let i = 0; i < count; i += 1) {
          button('Edit expense').click();
          await wait(150);
          button('Cancel').click();
          await wait(500);
        }
      }, cycles);
      const after = await read();
      const per = (key: string) => (((after[key] as number) - (before[key] as number)) * 1000) / cycles;
      rows.push({ run: r, app: name, cycles, reversal, turnedAround: reversal.peak > reversal.rest + 1 && Math.abs(reversal.end - reversal.rest) < 1, scriptMs: per('ScriptDuration'), layoutMs: per('LayoutDuration'), styleMs: per('RecalcStyleDuration'), taskMs: per('TaskDuration') });
      await browser.close();
      stop();
    }
  }
  saveRun(outName('runtime'), manifest({ experiment: 'runtime', runs: RUNS, cyclesPerRun: cycles, workload: 'open, wait 150 ms, reverse, wait 500 ms', units: 'milliseconds of main thread per cycle' }), { rows });
  return rows;
}

process.on('exit', () => {
  stop();
  rmSync(scratch, { recursive: true, force: true });
});

const out: Record<string, unknown> = {};
if (wanted('fidelity')) out.fidelity = await fidelity();
if (wanted('reference')) out.reference = await reference();
if (wanted('controls')) out.controls = await controls();
if (wanted('authoring')) out.authoring = await authoring();
if (wanted('size')) out.size = await size();
if (wanted('runtime')) out.runtime = await runtimeCost();
writeFileSync(resolve(`results/${smoke ? 'smoke/' : ''}last-run.json`), `${JSON.stringify(out, null, 1)}\n`);
console.log(smoke ? 'Smoke run finished. These numbers are not results.' : 'Measurement finished.');
process.exit(0);
