#!/usr/bin/env node
/**
 * Builds the static demo: the studio at / and a real exported build at /try/. Both use relative
 * paths, so the folder works from any host and any base path.
 *   node scripts/build-site.mjs [--out dist/site]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist/site');
const consumer = mkdtempSync(join(tmpdir(), 'frame-site-'));
const run = (command, commandArgs) => execFileSync(command, commandArgs, { stdio: 'inherit' });

run('node', ['packages/studio/cli/frame.mjs', 'build-demo', 'fixtures/inspector/frame.registrations.tsx', '--out', out, '--with-try']);
run('node', ['scripts/consumer.mjs', 'vite', '--out', consumer]);
cpSync(join(consumer, 'dist'), join(out, 'try'), { recursive: true });
rmSync(consumer, { recursive: true, force: true });
console.log(`Static site written to ${out}`);
