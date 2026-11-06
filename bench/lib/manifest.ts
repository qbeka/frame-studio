import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';

const text = (command: string, args: string[]) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

export const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Everything needed to say what a run was. Saved beside its raw samples. */
export function manifest(extra: Record<string, unknown>) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return {
    commit: text('git', ['rev-parse', 'HEAD']),
    dirty: (text('git', ['status', '--porcelain']) ?? '').length > 0,
    measuredAt: new Date().toISOString(),
    command: process.argv.slice(1).join(' '),
    node: process.version,
    devDependencies: pkg.devDependencies,
    inputs: {
      'pnpm-lock.yaml': sha256('pnpm-lock.yaml'),
      'bench/PROTOCOL.md': sha256('bench/PROTOCOL.md'),
      'fixtures/inspector/inspector.frame.json': sha256('fixtures/inspector/inspector.frame.json'),
      'tests/support/scripts.ts': sha256('tests/support/scripts.ts'),
    },
    os: `${platform()} ${release()}`,
    hardware: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) },
    power: text('pmset', ['-g', 'batt'])?.split('\n')[0] ?? null,
    ...extra,
  };
}

export function saveRun(name: string, meta: unknown, raw: Record<string, unknown>) {
  const dir = join('results', name);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(meta, null, 2)}\n`);
  for (const [file, value] of Object.entries(raw)) writeFileSync(join(dir, 'raw', `${file}.json`), `${JSON.stringify(value)}\n`);
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
