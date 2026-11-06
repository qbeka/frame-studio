#!/usr/bin/env node
/**
 * Targeted mutation test of the pure core and the parser.
 *
 * A mutant only counts as caught if a named assertion failed. First the unmodified suite must pass
 * in this same process, otherwise a broken environment would look like a perfect score. Each kill
 * records the test that failed, so the reasons can be read and not just counted.
 *
 *   node scripts/mutants.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const REPORT = '.artifacts/vitest.json';
const R = 'packages/studio/runtime/';
const A = 'packages/studio/authoring/';
const MUTANTS = [
  [R + 'spring.ts', 'const decay = z * w;\n    const b = (v0 + decay * d0) / wd;', 'const decay = z * w * 1.01;\n    const b = (v0 + decay * d0) / wd;', 'underdamped decay 1 percent high'],
  [R + 'spring.ts', 'velocity: e * (b - w * (d0 + b * t))', 'velocity: e * (b + w * (d0 + b * t))', 'critical velocity sign flipped'],
  [R + 'spring.ts', 'const r2 = -w * (z + root);', 'const r2 = -w * (z + root) * 1.001;', 'overdamped root off by 0.1 percent'],
  [R + 'spring.ts', 'const CRITICAL_BAND = 1e-8;', 'const CRITICAL_BAND = 1e-2;', 'critical band far too wide'],
  [R + 'spring.ts', 'return e > maxPosition || e * w > maxVelocity;', 'return e > maxPosition;', 'settle ignores velocity when underdamped'],
  [R + 'spring.ts', 'const overshoot = z < 1 ? Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z)) : 0;', 'const overshoot = z < 1 ? Math.exp(-Math.PI * z) : 0;', 'overshoot formula wrong'],
  [R + 'tween.ts', "velocity: ((to - from) * slope) / (duration / 1000),", "velocity: ((to - from) * slope) / duration,", 'tween velocity in the wrong unit'],
  [R + 'tween.ts', 'return 3 * c * c * s * a + 3 * c * s * s * b + s * s * s;', 'return 3 * c * c * s * a + 2 * c * s * s * b + s * s * s;', 'bezier weight wrong'],
  [R + 'channel.ts', 'const { position, velocity } = readChannel(channel, startMs);', 'const { position } = readChannel(channel, startMs); const velocity = 0;', 'retarget drops velocity'],
  [R + 'channel.ts', 'const { position, velocity } = readChannel(channel, startMs);', 'const { position, velocity } = readChannel(channel, decidedAtMs);', 'delayed retarget reads the wrong moment'],
  [R + 'channel.ts', 'while (channel.length > 1 && channel[channel.length - 1]!.startMs > decidedAtMs) channel.pop();', '', 'delayed legs survive a new command'],
  [R + 'channel.ts', 'if (t >= segment.settleMs) return { position: segment.to, velocity: 0 };', '', 'settled channels do not land on target'],
  [R + 'channel.ts', 'if (t < segment.startMs) return { position: segment.from, velocity: 0, target: segment.to, segment };', '', 'a channel moves before its first leg'],
  [R + 'timeline.ts', "running.interruptions.find((r) => r.command === command) ??\n    running.interruptions.find((r) => r.command === '*') ??", "running.interruptions.find((r) => r.command === '*') ??\n    running.interruptions.find((r) => r.command === command) ??", 'wildcard rule beats the exact rule'],
  [R + 'timeline.ts', "if (rule?.policy === 'ignore') return { kind: 'ignore', command };", '', 'ignore rule has no effect'],
  [R + 'timeline.ts', "if (rule?.policy === 'queue') return { kind: 'queue', command, atMs: mark.settleMs };", '', 'queue rule has no effect'],
  [R + 'timeline.ts', 'if (rule?.curve) return { curve: rule.curve, delayMs: 0 };', '', 'interruption curve ignored'],
  [R + 'timeline.ts', "if (policy === 'fade' && name === 'opacity') {", "if (policy === 'fade' && name === 'x') {", 'reduced motion fades the wrong channel'],
  [R + 'timeline.ts', 'retarget(timeline.channels[id]![name], atMs, atMs, pose[name], null, name, spec.settle);', '', 'entering target skips its start pose'],
  [R + 'timeline.ts', "const curve = running && policy === 'retarget' ? last.curve : null;", 'const curve = null;', 'resize always snaps'],
  [R + 'timeline.ts', "const curve = running && policy === 'retarget' ? last.curve : null;", 'const curve = last.curve;', 'resize snap policy ignored'],
  [R + 'timeline.ts', 'const exiting = !inFlow && t < (mark.targetSettleMs[id] ?? mark.atMs);', 'const exiting = false;', 'exiting targets vanish at once'],
  [R + 'timeline.ts', 'if (keepFrom > 0) channel.splice(0, keepFrom);', 'if (keepFrom > 0) channel.splice(0, keepFrom + 1);', 'prune removes the current leg'],
  [R + 'timeline.ts', "if (before && sameBox(before, rect)) continue;", '', 'unchanged layout still retargets'],
  [R + 'timeline.ts', 'clearQueue(timeline);\n      run(due.atMs, due.command, queuedReduced);', 'run(due.atMs, due.command, queuedReduced);\n      if (pendingQueue(timeline)) break;', 'replay leaves a refused command queued'],
  [R + 'timeline.ts', 'run(due.atMs, due.command, queuedReduced);', 'run(due.atMs, due.command, false);', 'replay forgets reduced motion on a queued command'],
  [R + 'timeline.ts', 'drainQueue((atMs) => atMs < event.atMs);', 'drainQueue((atMs) => atMs <= event.atMs);', 'replay runs a queued command before a layout change'],
  [R + 'timeline.ts', 'const startMs = curve !== null && last.startMs > atMs ? last.startMs : atMs;', 'const startMs = atMs;', 'a layout change cancels a delay'],
  [R + 'timeline.ts', 'box: mark.rects[id] ?? (exiting ? (mark.known[id] ?? null) : null),', 'box: mark.rects[id] ?? (exiting ? (timeline.lastRects[id] ?? null) : null),', 'old exits use the latest box'],
  [R + 'controller.ts', "if (item.fromQueue || item.decision.kind !== 'start') return;", "if (item.decision.kind !== 'start') return;", 'queued runs recorded twice'],
  [R + 'controller.ts', '      // A command can land after a queued one came due but before the next frame ran it.\n      drainDue(t);\n', '', 'late command loses the queue'],
  [R + 'controller.ts', '    applyUncommitted();\n    const decision', '    const decision', 'second command judged from the old state'],
  [R + 'controller.ts', "if (!fromQueue) options.onEvent?.({ atMs, type: 'command', command, reduced }, startMs);", '', 'ignored commands not recorded'],
  [R + 'controller.ts', '    // With a transition pending, the commit it triggered does the drawing.\n    if (pending.length > 0) return;\n    render();', '    if (pending.length > 0) return;', 'refused queue skips the final draw'],
  [R + 'controller.ts', '      wanted = true;\n      attach();\n      ensureLoop();', '      wanted = true;\n      attach();', 'restart leaves a queue stalled'],
  [R + 'controller.ts', 'if (!options.history) pruneTimeline(timeline, now());\n        ensureLoop();', 'ensureLoop();', 'instant transitions grow without limit'],
  [A + 'parse.ts', "if (typeof value === 'string' && NAME.test(value) && !(value in Object.prototype)) return value;", "if (typeof value === 'string' && value.length > 0) return value;", 'names not restricted'],
  [A + 'parse.ts', "if (!allowed.includes(key)) {", "if (false) {", 'unknown properties accepted'],
  [A + 'parse.ts', 'if (value < min || value > max) this.add(path, `must be from ${min} to ${max} ${unit}, got ${value}`);', '', 'range checks removed'],
  [A + 'parse.ts', 'if (typeof value !== \'number\' || !Number.isFinite(value)) {', "if (typeof value !== 'number') {", 'NaN and Infinity accepted'],
  [A + 'parse.ts', "if (target.text && target.bounds === 'scale') {", 'if (false) {', 'scale allowed on text'],
  [A + 'parse.ts', 'if (seenMoves.has(move)) r.add(path, `two transitions leave "${t.from}" on "${t.command}".`);', '', 'ambiguous transitions accepted'],
  [A + 'parse.ts', 'if (ms > LIMITS.maxSettleMs) {', 'if (false) {', 'a never ending spring accepted'],
  [A + 'migrate.ts', 'if (from > current) {', 'if (false) {', 'newer formats accepted'],
  [A + 'project.ts', "if (event.atMs < previous) problems.push({ path, message: 'is out of order.' });", '', 'out of order takes accepted'],
  [A + 'export.ts', "if (content === undefined) throw new Error(`The runtime file ${name} is missing from this build.`);", '', 'an incomplete export is written'],
];

function suite() {
  mkdirSync('.artifacts', { recursive: true });
  rmSync(REPORT, { force: true });
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${REPORT}`], { encoding: 'utf8' });
  if (!existsSync(REPORT)) return { total: 0, failed: [], crashed: true };
  const json = JSON.parse(readFileSync(REPORT, 'utf8'));
  const failed = json.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName));
  return { total: json.numTotalTests, failed, crashed: json.numFailedTestSuites > 0 && failed.length === 0 };
}

const baseline = suite();
if (baseline.failed.length > 0 || baseline.crashed) {
  console.error('The unmodified suite does not pass, so no score would mean anything.', baseline);
  process.exit(1);
}
console.log(`Baseline: ${baseline.total} tests pass.`);

const rows = [];
for (const [file, find, replace, name] of MUTANTS) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(find)) {
    rows.push({ name, file, status: 'did not apply' });
    console.log(`? ${name}: did not apply`);
    continue;
  }
  writeFileSync(file, source.replace(find, replace));
  try {
    const result = suite();
    const status = result.failed.length > 0 ? 'caught' : result.crashed ? 'crashed, not counted' : 'SURVIVED';
    rows.push({ name, file, status, killedBy: result.failed.slice(0, 3), kills: result.failed.length });
    console.log(`${status === 'caught' ? '+' : '!'} ${name}: ${status}${result.failed[0] ? ` (${result.failed[0]})` : ''}`);
  } finally {
    writeFileSync(file, source);
  }
}
const after = suite();
const caught = rows.filter((r) => r.status === 'caught').length;
const summary = { baselineTests: baseline.total, mutants: rows.length, caught, restoredSuitePasses: after.failed.length === 0, rows };
mkdirSync('results/mutants', { recursive: true });
writeFileSync('results/mutants/result.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Caught ${caught} of ${rows.length}.`);
