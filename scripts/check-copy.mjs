#!/usr/bin/env node
/** Fails on em or en dashes in tracked text, which this project's writing rules forbid. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(md|ts|tsx|mjs|css|html|json|py)$/.test(f))
  .filter((f) => !/pnpm-lock|^results\/|^evidence\/|spring-reference\.json/.test(f));

const banned = new RegExp('[\u2013\u2014]');
const failures = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (banned.test(line)) failures.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
  });
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Copy check passed on ${files.length} files.`);
