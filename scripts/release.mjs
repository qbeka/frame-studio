#!/usr/bin/env node
/**
 * Builds the local release in dist/release: the npm tarball, the static demo, a sample export,
 * a source archive, and a manifest of hashes. It publishes nothing.
 *   node scripts/release.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve('dist/release');
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, { cwd, stdio: 'pipe' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

run('pnpm', ['pack', '--pack-destination', out], resolve('packages/studio'));
run('node', ['scripts/build-site.mjs']);
run('tar', ['-czf', join(out, 'frame-demo-site.tgz'), '-C', 'dist/site', '.']);
const scratch = mkdtempSync(join(tmpdir(), 'frame-release-'));
run('node', ['packages/studio/cli/frame.mjs', 'export', 'fixtures/inspector/inspector.frame.json', '--out', join(scratch, 'inspector-motion')]);
run('tar', ['-czf', join(out, 'inspector-motion-export.tgz'), '-C', scratch, 'inspector-motion']);
rmSync(scratch, { recursive: true, force: true });
run('git', ['archive', '--format=tar.gz', '--prefix=frame-studio/', '-o', join(out, 'frame-studio-source.tgz'), 'HEAD']);

const commit = run('git', ['rev-parse', 'HEAD']).toString().trim();
const files = readdirSync(out).map((name) => {
  const bytes = readFileSync(join(out, name));
  return { name, bytes: statSync(join(out, name)).size, sha256: createHash('sha256').update(bytes).digest('hex') };
});
writeFileSync(join(out, 'MANIFEST.json'), `${JSON.stringify({ commit, builtAt: new Date().toISOString(), files }, null, 2)}\n`);
console.log(`Release in ${out} from ${commit.slice(0, 7)}`);
for (const f of files) console.log(`  ${f.name}  ${(f.bytes / 1024).toFixed(0)} KB`);
cpSync(join(out, 'MANIFEST.json'), 'docs/ARTIFACTS.json');
