import {
  MOTION_FORMAT,
  MOTION_VERSION,
  type Curve,
  type InterruptionRule,
  type MotionSpec,
  type ReducedMotionRule,
  type SettleThresholds,
  type StateSpec,
  type StateTargetValue,
  type TargetSpec,
  type Timing,
  type TransitionSpec,
} from '../runtime/spec';
import { springSettleSeconds } from '../runtime/spring';
import { migrate, MIGRATIONS, type MigrationTable } from './migrate';

export interface Problem {
  /** Where in the document, such as transitions[0].timing.delayMs. */
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T; migratedFrom: number } | { ok: false; problems: Problem[] };

/** Limits that keep a spec from running forever or producing nonsense. Units are in the names. */
export const LIMITS = {
  stiffness: [1, 10000],
  damping: [0.1, 2000],
  mass: [0.05, 50],
  durationMs: [0, 20000],
  delayMs: [0, 10000],
  /** A spring that takes longer than this to settle is almost certainly a typo. */
  maxSettleMs: 20000,
  /** Offsets beyond this are treated as a mistake. */
  offsetPx: 4000,
} as const;

type Json = Record<string, unknown>;

class Reader {
  problems: Problem[] = [];

  add(path: string, message: string) {
    this.problems.push({ path, message });
  }

  object(value: unknown, path: string): Json | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Json;
    this.add(path, `must be an object, got ${describe(value)}`);
    return null;
  }

  /** Unknown keys are errors. This is how an unsupported property gets a clear rejection. */
  keys(value: Json, path: string, allowed: string[], what = 'field') {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.add(`${path}.${key}`, `unsupported ${what}. Supported: ${allowed.join(', ')}`);
      }
    }
  }

  number(value: unknown, path: string, min: number, max: number, unit: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.add(path, `must be a number of ${unit}, got ${describe(value)}`);
      return min;
    }
    if (value < min || value > max) this.add(path, `must be from ${min} to ${max} ${unit}, got ${value}`);
    return value;
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string' && value.length > 0) return value;
    this.add(path, `must be a non-empty string, got ${describe(value)}`);
    return '';
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value === 'boolean') return value;
    this.add(path, `must be true or false, got ${describe(value)}`);
    return false;
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
    if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T;
    this.add(path, `must be one of ${options.join(', ')}, got ${describe(value)}`);
    return options[0]!;
  }

  array(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) return value;
    this.add(path, `must be a list, got ${describe(value)}`);
    return [];
  }
}

function describe(value: unknown) {
  if (value === undefined) return 'nothing';
  return JSON.stringify(value) ?? String(value);
}

function readCurve(r: Reader, value: unknown, path: string, settle: SettleThresholds | null): Curve {
  const fallback: Curve = { type: 'spring', stiffness: 100, damping: 20, mass: 1 };
  const curve = r.object(value, path);
  if (!curve) return fallback;
  const type = r.oneOf(curve.type, `${path}.type`, ['spring', 'tween'] as const);
  if (type === 'spring') {
    r.keys(curve, path, ['type', 'stiffness', 'damping', 'mass']);
    const spring = {
      type,
      stiffness: r.number(curve.stiffness, `${path}.stiffness`, ...LIMITS.stiffness, 'newtons per metre'),
      damping: r.number(curve.damping, `${path}.damping`, ...LIMITS.damping, 'newton seconds per metre'),
      mass: r.number(curve.mass, `${path}.mass`, ...LIMITS.mass, 'kilograms'),
    } as const;
    if (settle && r.problems.length === 0) {
      const ms = 1000 * springSettleSeconds(spring, 0, 0, 1000, settle.px, settle.pxPerSecond);
      if (ms > LIMITS.maxSettleMs) {
        r.add(path, `takes ${Math.round(ms)} ms to settle over 1000 px. The limit is ${LIMITS.maxSettleMs} ms.`);
      }
    }
    return spring;
  }
  r.keys(curve, path, ['type', 'durationMs', 'easing']);
  const easing = r.array(curve.easing, `${path}.easing`);
  if (easing.length !== 4) r.add(`${path}.easing`, `must be four cubic-bezier numbers, got ${easing.length}`);
  const point = (i: number, min: number, max: number) => r.number(easing[i], `${path}.easing[${i}]`, min, max, 'bezier units');
  return {
    type,
    durationMs: r.number(curve.durationMs, `${path}.durationMs`, ...LIMITS.durationMs, 'milliseconds'),
    easing: [point(0, 0, 1), point(1, -2, 3), point(2, 0, 1), point(3, -2, 3)],
  };
}

function readTiming(r: Reader, value: unknown, path: string, settle: SettleThresholds | null): Timing {
  const timing = r.object(value, path);
  if (!timing) return { curve: readCurve(r, undefined, `${path}.curve`, null), delayMs: 0 };
  r.keys(timing, path, ['curve', 'delayMs']);
  return {
    curve: readCurve(r, timing.curve, `${path}.curve`, settle),
    delayMs: r.number(timing.delayMs, `${path}.delayMs`, ...LIMITS.delayMs, 'milliseconds'),
  };
}

function readSettle(r: Reader, value: unknown): SettleThresholds {
  const settle = r.object(value, 'settle') ?? {};
  r.keys(settle, 'settle', ['px', 'pxPerSecond', 'unit', 'unitPerSecond']);
  return {
    px: r.number(settle.px, 'settle.px', 0.001, 2, 'pixels'),
    pxPerSecond: r.number(settle.pxPerSecond, 'settle.pxPerSecond', 0.01, 100, 'pixels per second'),
    unit: r.number(settle.unit, 'settle.unit', 0.00001, 0.05, 'units'),
    unitPerSecond: r.number(settle.unitPerSecond, 'settle.unitPerSecond', 0.0001, 5, 'units per second'),
  };
}

function readPose(r: Reader, value: unknown, path: string): StateTargetValue {
  const pose = r.object(value, path) ?? {};
  r.keys(pose, path, ['present', 'opacity', 'xPx', 'yPx', 'scale'], 'property');
  return {
    present: r.boolean(pose.present, `${path}.present`),
    opacity: r.number(pose.opacity, `${path}.opacity`, 0, 1, 'opacity units'),
    xPx: r.number(pose.xPx, `${path}.xPx`, -LIMITS.offsetPx, LIMITS.offsetPx, 'pixels'),
    yPx: r.number(pose.yPx, `${path}.yPx`, -LIMITS.offsetPx, LIMITS.offsetPx, 'pixels'),
    scale: r.number(pose.scale, `${path}.scale`, 0, 10, 'scale units'),
  };
}

function readInterruption(r: Reader, value: unknown, path: string, settle: SettleThresholds): InterruptionRule {
  const rule = r.object(value, path) ?? {};
  r.keys(rule, path, ['command', 'policy', 'curve']);
  return {
    command: r.string(rule.command, `${path}.command`),
    policy: r.oneOf(rule.policy, `${path}.policy`, ['retarget', 'queue', 'ignore'] as const),
    curve: rule.curve === null ? null : readCurve(r, rule.curve, `${path}.curve`, settle),
  };
}

function readReduced(r: Reader, value: unknown, path: string): ReducedMotionRule {
  const rule = r.object(value, path) ?? {};
  r.keys(rule, path, ['policy', 'durationMs']);
  return {
    policy: r.oneOf(rule.policy, `${path}.policy`, ['instant', 'fade'] as const),
    durationMs: r.number(rule.durationMs, `${path}.durationMs`, 0, 2000, 'milliseconds'),
  };
}

function readTransition(r: Reader, value: unknown, path: string, settle: SettleThresholds): TransitionSpec {
  const t = r.object(value, path) ?? {};
  r.keys(t, path, ['id', 'from', 'to', 'command', 'timing', 'targets', 'interruptions', 'reducedMotion']);
  const overrides = r.object(t.targets, `${path}.targets`) ?? {};
  const targets: TransitionSpec['targets'] = {};
  for (const [id, groups] of Object.entries(overrides)) {
    const groupPath = `${path}.targets.${id}`;
    const group = r.object(groups, groupPath) ?? {};
    r.keys(group, groupPath, ['position', 'size', 'opacity', 'scale'], 'property');
    targets[id] = {};
    for (const name of ['position', 'size', 'opacity', 'scale'] as const) {
      if (group[name] !== undefined) targets[id]![name] = readTiming(r, group[name], `${groupPath}.${name}`, settle);
    }
  }
  return {
    id: r.string(t.id, `${path}.id`),
    from: r.string(t.from, `${path}.from`),
    to: r.string(t.to, `${path}.to`),
    command: r.string(t.command, `${path}.command`),
    timing: readTiming(r, t.timing, `${path}.timing`, settle),
    targets,
    interruptions: r
      .array(t.interruptions, `${path}.interruptions`)
      .map((rule, i) => readInterruption(r, rule, `${path}.interruptions[${i}]`, settle)),
    reducedMotion: readReduced(r, t.reducedMotion, `${path}.reducedMotion`),
  };
}

function crossCheck(r: Reader, spec: MotionSpec) {
  const targetIds = Object.keys(spec.targets);
  if (!spec.states[spec.initialState]) r.add('initialState', `no state named "${spec.initialState}"`);

  for (const [id, target] of Object.entries(spec.targets)) {
    if (target.text && target.bounds === 'scale') {
      r.add(`targets.${id}.bounds`, 'scale would distort text. Use translate, clip, or mark text as false.');
    }
  }

  for (const [stateId, state] of Object.entries(spec.states)) {
    for (const id of targetIds) {
      if (!state.targets[id]) r.add(`states.${stateId}.targets.${id}`, 'is missing. Every state needs every target.');
      else if (spec.targets[id]!.text && state.targets[id]!.scale !== 1) {
        r.add(`states.${stateId}.targets.${id}.scale`, 'must be 1 on a target that holds text.');
      }
    }
    for (const id of Object.keys(state.targets)) {
      if (!spec.targets[id]) r.add(`states.${stateId}.targets.${id}`, 'is not a declared target.');
    }
    if (state.focusTarget !== null) {
      if (!spec.targets[state.focusTarget]) r.add(`states.${stateId}.focusTarget`, `no target named "${state.focusTarget}"`);
      else if (state.targets[state.focusTarget]?.present === false) {
        r.add(`states.${stateId}.focusTarget`, `"${state.focusTarget}" is not present in this state.`);
      }
    }
  }

  const seenIds = new Set<string>();
  const seenMoves = new Set<string>();
  spec.transitions.forEach((t, i) => {
    const path = `transitions[${i}]`;
    if (seenIds.has(t.id)) r.add(`${path}.id`, `"${t.id}" is used twice.`);
    seenIds.add(t.id);
    if (!spec.states[t.from]) r.add(`${path}.from`, `no state named "${t.from}"`);
    if (!spec.states[t.to]) r.add(`${path}.to`, `no state named "${t.to}"`);
    if (!spec.commands.includes(t.command)) r.add(`${path}.command`, `no command named "${t.command}"`);
    const move = `${t.from} ${t.command}`;
    if (seenMoves.has(move)) r.add(path, `two transitions leave "${t.from}" on "${t.command}".`);
    seenMoves.add(move);
    for (const id of Object.keys(t.targets)) {
      if (!spec.targets[id]) r.add(`${path}.targets.${id}`, 'is not a declared target.');
      else if (t.targets[id]?.scale && spec.targets[id]!.text) {
        r.add(`${path}.targets.${id}.scale`, 'text is never scaled.');
      }
    }
    t.interruptions.forEach((rule, j) => {
      if (rule.command !== '*' && !spec.commands.includes(rule.command)) {
        r.add(`${path}.interruptions[${j}].command`, `no command named "${rule.command}"`);
      }
    });
  });
}

/** Reads a motion spec. It either returns a complete spec or says everything wrong with it. */
export function parseMotionSpec(input: unknown, table: MigrationTable = MIGRATIONS): ParseResult<MotionSpec> {
  const r = new Reader();
  const root = r.object(input, 'spec');
  if (!root) return { ok: false, problems: r.problems };
  if (root.format !== MOTION_FORMAT) {
    return { ok: false, problems: [{ path: 'format', message: `must be "${MOTION_FORMAT}", got ${describe(root.format)}` }] };
  }
  const migrated = migrate(root, MOTION_VERSION, table);
  if (!migrated.ok) return { ok: false, problems: [{ path: 'version', message: migrated.message }] };
  const doc = migrated.document;

  r.keys(doc, 'spec', ['format', 'version', 'component', 'initialState', 'commands', 'targets', 'states', 'transitions', 'settle', 'resize']);
  const settle = readSettle(r, doc.settle);
  const component = r.object(doc.component, 'component') ?? {};
  r.keys(component, 'component', ['id', 'version']);

  const targets: Record<string, TargetSpec> = {};
  for (const [id, value] of Object.entries(r.object(doc.targets, 'targets') ?? {})) {
    const path = `targets.${id}`;
    const target = r.object(value, path) ?? {};
    r.keys(target, path, ['bounds', 'text', 'clipRadiusPx']);
    targets[id] = {
      bounds: r.oneOf(target.bounds, `${path}.bounds`, ['translate', 'surface', 'clip', 'scale'] as const),
      text: r.boolean(target.text, `${path}.text`),
      clipRadiusPx: r.number(target.clipRadiusPx, `${path}.clipRadiusPx`, 0, 200, 'pixels'),
    };
  }

  const states: Record<string, StateSpec> = {};
  for (const [id, value] of Object.entries(r.object(doc.states, 'states') ?? {})) {
    const path = `states.${id}`;
    const state = r.object(value, path) ?? {};
    r.keys(state, path, ['label', 'focusTarget', 'targets']);
    const poses: StateSpec['targets'] = {};
    for (const [targetId, pose] of Object.entries(r.object(state.targets, `${path}.targets`) ?? {})) {
      poses[targetId] = readPose(r, pose, `${path}.targets.${targetId}`);
    }
    states[id] = {
      label: r.string(state.label, `${path}.label`),
      focusTarget: state.focusTarget === null ? null : r.string(state.focusTarget, `${path}.focusTarget`),
      targets: poses,
    };
  }

  const spec: MotionSpec = {
    format: MOTION_FORMAT,
    version: MOTION_VERSION,
    component: { id: r.string(component.id, 'component.id'), version: r.string(component.version, 'component.version') },
    initialState: r.string(doc.initialState, 'initialState'),
    commands: r.array(doc.commands, 'commands').map((c, i) => r.string(c, `commands[${i}]`)),
    targets,
    states,
    transitions: r
      .array(doc.transitions, 'transitions')
      .map((t, i) => readTransition(r, t, `transitions[${i}]`, settle)),
    settle,
    resize: r.oneOf(doc.resize, 'resize', ['retarget', 'snap'] as const),
  };
  if (r.problems.length === 0) crossCheck(r, spec);
  if (Object.keys(spec.targets).length === 0) r.add('targets', 'must declare at least one target.');
  if (r.problems.length > 0) return { ok: false, problems: r.problems };
  return { ok: true, value: spec, migratedFrom: migrated.from };
}
