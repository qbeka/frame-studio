#!/usr/bin/env node
/**
 * Fails on writing this project's rules forbid.
 *
 * Everywhere: em or en dashes in tracked text.
 *
 * In the page and the studio: a status line, hint, label or caption that ends with a period.
 * Those are single sentences with no closing period. Body paragraphs are prose and keep theirs,
 * which here means `p.prose` and the list of limits in the page's HTML. Messages for developers,
 * thrown or logged, are left alone, and so is what the example components themselves say.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(md|ts|tsx|mjs|css|html|json|py)$/.test(f))
  .filter((f) => !/pnpm-lock|^results\/|^evidence\/|spring-reference\.json/.test(f));

const banned = new RegExp('[\u2013\u2014]');
const failures = [];
const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const show = (text) => text.replace(/\s+/g, ' ').trim().slice(-80);

for (const file of files) {
  const text = read(file);
  if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    if (banned.test(line)) failures.push(`${file}:${i + 1}: dash: ${line.trim().slice(0, 80)}`);
  });
}

/** Interface source: the page and the studio, without the example components' own content. */
const INTERFACE = /^(site\/src|packages\/studio\/editor\/src)\/.*\.tsx?$/;
const CONTENT = /^site\/src\/showcase\//;
/** Text that ends a sentence right before its element closes. */
const CLOSING = /[A-Za-z0-9)%]\.\s*<\/(p|span|li|dd|dt|em|b|h[1-6]|button|label|figcaption|output|strong|small|div|a)>/g;
/** A string or template that reads as a sentence and ends with a period. */
const LITERAL = /(['"`])((?:(?!\1)[^\\\n]|\\.)*?[A-Za-z0-9)%}]\.)\1/g;
const DEVELOPER = /throw new Error\(|console\.(warn|error|log)\(/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

for (const file of files.filter((f) => INTERFACE.test(f) && !CONTENT.test(f))) {
  const text = read(file);
  if (text === null) continue;
  for (const match of text.matchAll(CLOSING)) {
    failures.push(`${file}:${lineOf(text, match.index)}: closing period: ${show(text.slice(Math.max(0, match.index - 70), match.index + 2))}`);
  }
  text.split('\n').forEach((line, i) => {
    if (COMMENT.test(line) || DEVELOPER.test(line)) return;
    for (const match of line.matchAll(LITERAL)) {
      // What a template works out is not writing, so only the words around it are read.
      if (!match[2].replace(/\$\{[^}]*\}/g, 'x').includes(' ')) continue;
      failures.push(`${file}:${i + 1}: closing period: ${show(match[2])}`);
    }
  });
}

/** In HTML only a prose paragraph or an item in the list of limits may end with a period. */
const HTML_CLOSING = /[A-Za-z0-9)%]\.\s*<\/(h[1-6]|figcaption|button|label|dt|dd|span|b|a|output|summary|title)>/g;
const HTML_PARAGRAPH = /<p(?![^>]*class="prose")[^>]*>(?:(?!<\/p>)[\s\S])*?[A-Za-z0-9)%]\.\s*<\/p>/g;
const HTML_META = /<meta[^>]+(?:name="description"|property="og:(?:title|description)")[^>]+content="[^"]*\."/g;
for (const file of files.filter((f) => /^(site|packages\/studio\/editor)\/index\.html$/.test(f))) {
  const text = read(file);
  if (text === null) continue;
  for (const pattern of [HTML_CLOSING, HTML_PARAGRAPH, HTML_META]) {
    for (const match of text.matchAll(pattern)) failures.push(`${file}:${lineOf(text, match.index + match[0].length)}: closing period: ${show(match[0])}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Copy check passed on ${files.length} files.`);
