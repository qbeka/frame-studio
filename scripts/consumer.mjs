#!/usr/bin/env node
/**
 * Builds a clean consumer outside this repository, using only exported files.
 *
 *   node scripts/consumer.mjs vite [--project file.frame.json] [--out dir] [--serve port]
 *
 * It copies a template to a temp folder, runs the CLI export into it, installs with the
 * template's own lockfile outside the workspace, and runs that app's own build, which includes
 * its type check. Because the folder is outside the repo, an import that leaks back into
 * Frame cannot resolve and fails the build.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const kind = args[0] ?? 'vite';
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const project = resolve(option('project', join(repo, 'fixtures/inspector/inspector.frame.json')));
const out = resolve(option('out', mkdtempSync(join(tmpdir(), `frame-consumer-${kind}-`))));
const serve = option('serve', null);

const run = (command, commandArgs, cwd) => execFileSync(command, commandArgs, { cwd, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
cpSync(join(repo, `examples/consumer-${kind}`), out, { recursive: true, filter: (src) => !/node_modules|\.next|dist$/.test(src) });

const src = join(out, kind === 'next' ? 'app' : 'src');
run('node', [join(repo, 'packages/studio/cli/frame.mjs'), 'export', project, '--out', join(src, 'motion')], repo);

// The component is the consumer's own code. Its only Frame import is the handle type.
const component = readFileSync(join(repo, 'fixtures/inspector/Inspector.tsx'), 'utf8').replace("'frame-studio/runtime'", "'./motion/runtime'");
writeFileSync(join(src, 'Inspector.tsx'), kind === 'next' ? `'use client';\n\n${component}` : component);
cpSync(join(repo, 'fixtures/inspector/inspector.css'), join(src, 'inspector.css'));
if (kind !== 'next') cpSync(join(repo, 'packages/studio/editor/src/manualClock.ts'), join(src, 'manualClock.ts'));

run('pnpm', ['install', '--ignore-workspace', '--frozen-lockfile', '--prefer-offline'], out);
run('pnpm', ['run', 'build'], out);
console.log(`CONSUMER_DIR=${out}`);

if (serve) {
  const start = kind === 'next' ? ['exec', 'next', 'start', '-p', serve] : ['exec', 'vite', 'preview', '--port', serve, '--strictPort'];
  spawn('pnpm', start, { cwd: out, stdio: 'inherit' });
}
