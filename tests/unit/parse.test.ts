import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrate, parseAnyDocument, parseMotionSpec, parseProject, type MigrationTable } from 'frame-studio/authoring';

const project = JSON.parse(readFileSync(new URL('../../fixtures/inspector/inspector.frame.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(project.spec);

function problems(mutate: (spec: any) => void) {
  const spec = clone();
  mutate(spec);
  const result = parseMotionSpec(spec);
  if (result.ok) throw new Error('expected a rejection');
  return result.problems;
}

describe('parseMotionSpec', () => {
  it('accepts the fixture and returns the same data', () => {
    const result = parseMotionSpec(clone());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(project.spec);
  });

  const cases: [string, (s: any) => void, string, RegExp][] = [
    ['a duration written as a string', (s) => (s.transitions[0].timing.delayMs = '300ms'), 'transitions[0].timing.delayMs', /number of milliseconds/],
    ['a negative delay', (s) => (s.transitions[0].timing.delayMs = -1), 'transitions[0].timing.delayMs', /from 0/],
    ['a NaN stiffness', (s) => (s.transitions[0].timing.curve.stiffness = Number.NaN), 'transitions[0].timing.curve.stiffness', /number of newtons/],
    ['infinite damping', (s) => (s.transitions[0].timing.curve.damping = Number.POSITIVE_INFINITY), 'transitions[0].timing.curve.damping', /number/],
    ['zero damping', (s) => (s.transitions[0].timing.curve.damping = 0), 'transitions[0].timing.curve.damping', /from 0.1/],
    ['missing mass', (s) => delete s.transitions[0].timing.curve.mass, 'transitions[0].timing.curve.mass', /got nothing/],
    ['an unknown curve', (s) => (s.transitions[0].timing.curve.type = 'bounce'), 'transitions[0].timing.curve.type', /spring, tween/],
    ['a bad bezier', (s) => (s.transitions[0].timing.curve = { type: 'tween', durationMs: 100, easing: [2, 0, 1, 1] }), 'transitions[0].timing.curve.easing[0]', /from 0 to 1/],
    ['a short bezier', (s) => (s.transitions[0].timing.curve = { type: 'tween', durationMs: 100, easing: [0, 0, 1] }), 'transitions[0].timing.curve.easing', /four cubic-bezier/],
    ['an unsupported property on a pose', (s) => (s.states.compact.targets.summary.rotate = 10), 'states.compact.targets.summary.rotate', /unsupported property/],
    ['an unsupported property on a timing', (s) => (s.transitions[0].targets = { summary: { blur: { curve: {}, delayMs: 0 } } }), 'transitions[0].targets.summary.blur', /unsupported property/],
    ['an unknown top level field', (s) => (s.color = 'red'), 'spec.color', /unsupported field/],
    ['a missing target in a state', (s) => delete s.states.compact.targets.form, 'states.compact.targets.form', /Every state needs every target/],
    ['an undeclared target in a state', (s) => (s.states.compact.targets.ghost = s.states.compact.targets.form), 'states.compact.targets.ghost', /not a declared target/],
    ['a transition to nowhere', (s) => (s.transitions[0].to = 'nowhere'), 'transitions[0].to', /no state named/],
    ['an unknown command', (s) => (s.transitions[0].command = 'jump'), 'transitions[0].command', /no command named/],
    ['an unknown interruption command', (s) => (s.transitions[0].interruptions[0].command = 'jump'), 'transitions[0].interruptions[0].command', /no command named/],
    ['two moves on one command', (s) => s.transitions.push({ ...s.transitions[0], id: 'other' }), 'transitions[5]', /two transitions leave/],
    ['a duplicate transition id', (s) => s.transitions.push({ ...s.transitions[1], from: 'confirmation', command: 'open' }), 'transitions[5].id', /used twice/],
    ['a bad initial state', (s) => (s.initialState = 'none'), 'initialState', /no state named/],
    ['a focus target that is absent', (s) => (s.states.compact.focusTarget = 'form'), 'states.compact.focusTarget', /not present/],
    ['scale bounds on text', (s) => (s.targets.summary.bounds = 'scale'), 'targets.summary.bounds', /distort text/],
    ['a scale pose on text', (s) => (s.states.compact.targets.summary.scale = 1.2), 'states.compact.targets.summary.scale', /must be 1/],
    ['a scale timing on text', (s) => (s.transitions[0].targets = { summary: { scale: { curve: s.transitions[0].timing.curve, delayMs: 0 } } }), 'transitions[0].targets.summary.scale', /never scaled/],
    ['opacity above one', (s) => (s.states.compact.targets.summary.opacity = 1.5), 'states.compact.targets.summary.opacity', /from 0 to 1/],
    ['a bad resize policy', (s) => (s.resize = 'stretch'), 'resize', /retarget, snap/],
    ['a spring that barely settles', (s) => (s.transitions[0].timing.curve = { type: 'spring', stiffness: 1, damping: 0.1, mass: 50 }), 'transitions[0].timing.curve', /to settle/],
  ];

  for (const [name, mutate, path, message] of cases) {
    it(`rejects ${name}`, () => {
      const found = problems(mutate);
      const match = found.find((p) => p.path === path);
      expect(match, JSON.stringify(found)).toBeDefined();
      expect(match!.message).toMatch(message);
    });
  }

  it('reports every problem at once, not only the first', () => {
    const found = problems((s) => {
      s.transitions[0].timing.delayMs = 'soon';
      s.transitions[1].timing.curve.mass = -1;
    });
    expect(found).toHaveLength(2);
  });

  it('rejects things that are not specs at all', () => {
    for (const input of [null, 7, 'text', [], {}, { format: 'other' }]) expect(parseMotionSpec(input).ok).toBe(false);
  });
});

describe('format versions', () => {
  it('refuses a file from a newer version instead of guessing', () => {
    const result = parseMotionSpec({ ...clone(), version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]!.message).toMatch(/reads up to format 1/);
  });

  it('rejects a version that is not a whole number', () => {
    expect(migrate({ version: '1' }, 1).ok).toBe(false);
    expect(migrate({ version: 1.5 }, 1).ok).toBe(false);
  });

  // No released format needs migrating yet, so this uses a made-up format 2 that renames a field
  // and turns seconds into milliseconds, the sort of change the table exists for.
  const twoSteps: MigrationTable = {
    1: (d) => ({ ...d, version: 2, renamed: d.old }),
    2: (d) => ({ ...d, version: 3, delayMs: (d.delaySeconds as number) * 1000 }),
  };

  it('upgrades one step at a time', () => {
    const result = migrate({ version: 1, old: 'x', delaySeconds: 2 }, 3, twoSteps);
    expect(result).toMatchObject({ ok: true, from: 1, document: { version: 3, renamed: 'x', delayMs: 2000 } });
  });

  it('stops when a step is missing', () => {
    expect(migrate({ version: 1 }, 3, { 1: (d) => ({ ...d, version: 2 }) })).toMatchObject({ ok: false, message: 'No migration from format 2.' });
  });

  it('stops when a step produces the wrong version', () => {
    expect(migrate({ version: 1 }, 2, { 1: (d) => d })).toMatchObject({ ok: false });
  });
});

describe('project files', () => {
  it('accepts a project and a bare spec', () => {
    expect(parseProject(project).ok).toBe(true);
    expect(parseAnyDocument(project).ok).toBe(true);
    expect(parseAnyDocument(clone()).ok).toBe(true);
  });

  const take = { startMs: 0, initialState: 'compact', initialRects: {}, initialProps: {}, events: [] };

  it('reports a spec problem under the spec path', () => {
    const bad = structuredClone(project);
    bad.spec.resize = 'x';
    const result = parseProject(bad);
    expect(!result.ok && result.problems[0]!.path).toBe('spec.resize');
  });

  it.each([
    ['a take missing its fields', { events: [] }],
    ['an event with no time', { ...take, events: [{ type: 'command', command: 'open' }] }],
    ['a NaN event time', { ...take, events: [{ atMs: Number.NaN, type: 'command', command: 'open' }] }],
    ['events out of order', { ...take, events: [{ atMs: 5, type: 'command', command: 'open' }, { atMs: 1, type: 'command', command: 'cancel' }] }],
    ['an unknown event', { ...take, events: [{ atMs: 1, type: 'sneeze' }] }],
    ['a broken box', { ...take, events: [{ atMs: 1, type: 'measure', rects: { a: { x: 'left' } } }] }],
    ['an unknown starting state', { ...take, initialState: 'nope' }],
  ])('rejects %s', (_, badTake) => {
    expect(parseProject({ ...project, take: badTake }).ok).toBe(false);
  });
});
