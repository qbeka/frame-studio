#!/usr/bin/env node
/**
 * Sets up the clean receipt app in a folder outside this repository. Its only link to Frame is
 * the tarball that a real user would install.
 *   node scripts/receipt-consumer.mjs <folder>
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? fail('Pass a folder.'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

function fail(message) {
  console.error(message);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(join(repo, 'examples/receipt-app'), out, { recursive: true, filter: (src) => !/node_modules|dist$/.test(src) });
cpSync(join(repo, 'packages/studio/editor/src/manualClock.ts'), join(out, 'src/manualClock.ts'));
mkdirSync(join(out, 'vendor'), { recursive: true });
run('pnpm', ['pack', '--pack-destination', join(out, 'vendor')], join(repo, 'packages/studio'));
console.log(readdirSync(join(out, 'vendor')));
run('pnpm', ['install', '--ignore-workspace', '--prefer-offline', '--no-frozen-lockfile'], out);
