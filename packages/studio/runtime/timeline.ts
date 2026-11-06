import type {
  Curve,
  InterruptionRule,
  MotionSpec,
  PropertyGroup,
  Rect,
  Rects,
  StateTargetValue,
  Timing,
  TransitionSpec,
} from './spec';
import {
  readChannel,
  restingChannel,
  retarget,
  type Channel,
  type ChannelName,
  type ChannelReading,
} from './channel';

/**
 * The timeline is the pure core: spec plus timestamped events gives values at any t, with no
 * clock, DOM or React here. The preview, the export and the replay all run this code. That alone
 * proves nothing about fidelity, so the reference suite checks it against other math and the
 * browser suite checks real geometry.
 */

const CHANNELS: ChannelName[] = ['x', 'y', 'width', 'height', 'opacity', 'scale'];
const GROUP: Record<ChannelName, PropertyGroup> = {
  x: 'position',
  y: 'position',
  width: 'size',
  height: 'size',
  opacity: 'opacity',
  scale: 'scale',
};

/** A moment the semantic state or the measured layout changed. */
export interface Mark {
  atMs: number;
  state: string;
  transitionId: string | null;
  /** Layout boxes of targets in flow at this moment. */
  rects: Rects;
  /** When all channels finish, as known at this mark. */
  settleMs: number;
  /** The same per target. An exiting target stays drawn until its own time. */
  targetSettleMs: Record<string, number>;
  /** A command waiting for settleMs. */
  queued: string | null;
}

export interface Timeline {
  spec: MotionSpec;
  channels: Record<string, Record<ChannelName, Channel>>;
  /** Last known box of every target, kept after it leaves flow so it can exit from there. */
  lastRects: Rects;
  marks: Mark[];
}

export type Decision =
  | { kind: 'start'; transition: TransitionSpec; rule: InterruptionRule | null }
  | { kind: 'queue'; command: string; atMs: number }
  | { kind: 'ignore'; command: string }
  | { kind: 'reject'; command: string; reason: 'no-transition' };

export interface ApplyOptions {
  reduced: boolean;
}

export interface TargetSample {
  id: string;
  /** In document flow in the current state. */
  inFlow: boolean;
  /** Out of flow but still drawn, because its exit has not finished. */
  exiting: boolean;
  /** The layout box the evaluated values are drawn against. */
  box: Rect | null;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  scale: number;
}

export interface Sample {
  atMs: number;
  state: string;
  transitionId: string | null;
  animating: boolean;
  targets: Record<string, TargetSample>;
}

function poseValues(rect: Rect, pose: StateTargetValue): Record<ChannelName, number> {
  return {
    x: rect.x + pose.xPx,
    y: rect.y + pose.yPx,
    width: rect.width,
    height: rect.height,
    opacity: pose.opacity,
    scale: pose.scale,
  };
}

function poseChannels(atMs: number, rect: Rect, pose: StateTargetValue): Record<ChannelName, Channel> {
  const values = poseValues(rect, pose);
  return {
    x: restingChannel(atMs, values.x),
    y: restingChannel(atMs, values.y),
    width: restingChannel(atMs, values.width),
    height: restingChannel(atMs, values.height),
    opacity: restingChannel(atMs, values.opacity),
    scale: restingChannel(atMs, values.scale),
  };
}

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function createTimeline(spec: MotionSpec, atMs: number, rects: Rects): Timeline {
  const channels: Timeline['channels'] = {};
  const state = spec.states[spec.initialState]!;
  for (const id of Object.keys(spec.targets)) {
    channels[id] = poseChannels(atMs, rects[id] ?? NOWHERE, state.targets[id]!);
  }
  const mark: Mark = {
    atMs,
    state: spec.initialState,
    transitionId: null,
    rects: { ...rects },
    settleMs: atMs,
    targetSettleMs: {},
    queued: null,
  };
  return { spec, channels, lastRects: { ...rects }, marks: [mark] };
}

export function lastMark(timeline: Timeline): Mark {
  return timeline.marks[timeline.marks.length - 1]!;
}

function markAt(timeline: Timeline, t: number): Mark {
  for (let i = timeline.marks.length - 1; i > 0; i -= 1) {
    if (timeline.marks[i]!.atMs <= t) return timeline.marks[i]!;
  }
  return timeline.marks[0]!;
}

export function isAnimating(timeline: Timeline, t: number): boolean {
  return t < markAt(timeline, t).settleMs;
}

/** Pure: says what a command means at atMs. Nothing changes until `applyDecision`. */
export function decideCommand(timeline: Timeline, atMs: number, command: string): Decision {
  const { spec } = timeline;
  const mark = markAt(timeline, atMs);
  const transition = spec.transitions.find((t) => t.from === mark.state && t.command === command);
  const running =
    atMs < mark.settleMs && mark.transitionId !== null
      ? spec.transitions.find((t) => t.id === mark.transitionId)
      : undefined;
  if (!running) {
    if (!transition) return { kind: 'reject', command, reason: 'no-transition' };
    return { kind: 'start', transition, rule: null };
  }
  const rule =
    running.interruptions.find((r) => r.command === command) ??
    running.interruptions.find((r) => r.command === '*') ??
    null;
  if (rule?.policy === 'ignore') return { kind: 'ignore', command };
  // A queued command is judged when it runs, from the state it will run in.
  if (rule?.policy === 'queue') return { kind: 'queue', command, atMs: mark.settleMs };
  if (!transition) return { kind: 'reject', command, reason: 'no-transition' };
  return { kind: 'start', transition, rule };
}

function timingFor(transition: TransitionSpec, id: string, group: PropertyGroup): Timing {
  return transition.targets[id]?.[group] ?? transition.timing;
}

const LINEAR: [number, number, number, number] = [0, 0, 1, 1];

function curveFor(
  transition: TransitionSpec,
  rule: InterruptionRule | null,
  id: string,
  name: ChannelName,
  options: ApplyOptions,
): { curve: Curve | null; delayMs: number } {
  if (options.reduced) {
    const { policy, durationMs } = transition.reducedMotion;
    if (policy === 'fade' && name === 'opacity') {
      return { curve: { type: 'tween', durationMs, easing: LINEAR }, delayMs: 0 };
    }
    return { curve: null, delayMs: 0 };
  }
  if (rule?.curve) return { curve: rule.curve, delayMs: 0 };
  return timingFor(transition, id, GROUP[name]);
}

function animatesSize(spec: MotionSpec, id: string) {
  return spec.targets[id]!.bounds !== 'translate';
}

function drawnAt(timeline: Timeline, id: string, t: number): boolean {
  const mark = markAt(timeline, t);
  const inFlow = timeline.spec.states[mark.state]!.targets[id]!.present;
  return inFlow || t < (mark.targetSettleMs[id] ?? mark.atMs);
}

function latestSettle(channels: Record<ChannelName, Channel>): number {
  let latest = 0;
  for (const name of CHANNELS) {
    const channel = channels[name];
    latest = Math.max(latest, channel[channel.length - 1]!.settleMs);
  }
  return latest;
}

function pushMark(
  timeline: Timeline,
  atMs: number,
  state: string,
  transitionId: string | null,
  rects: Rects,
  queued: string | null,
) {
  const targetSettleMs: Record<string, number> = {};
  let settleMs = atMs;
  for (const id of Object.keys(timeline.channels)) {
    const settle = latestSettle(timeline.channels[id]!);
    targetSettleMs[id] = settle;
    settleMs = Math.max(settleMs, settle);
  }
  timeline.marks.push({ atMs, state, transitionId, rects: { ...rects }, settleMs, targetSettleMs, queued });
}

/**
 * Runs a decision at atMs. `rects` must be the layout of the state being entered, measured
 * after that state has been committed to the DOM. Returns the targets that were missing.
 */
export function applyDecision(
  timeline: Timeline,
  atMs: number,
  decision: Decision,
  rects: Rects,
  options: ApplyOptions,
): string[] {
  const mark = lastMark(timeline);
  if (decision.kind === 'queue') {
    timeline.marks.push({ ...mark, atMs, queued: decision.command });
    return [];
  }
  if (decision.kind !== 'start') return [];

  const { spec } = timeline;
  const { transition, rule } = decision;
  const fromState = spec.states[transition.from]!;
  const toState = spec.states[transition.to]!;
  const missing: string[] = [];

  for (const id of Object.keys(spec.targets)) {
    const start = fromState.targets[id]!;
    const end = toState.targets[id]!;
    const rect = rects[id];
    if (end.present && !rect) {
      missing.push(id);
      continue;
    }
    if (rect) timeline.lastRects[id] = rect;
    const box = timeline.lastRects[id] ?? NOWHERE;
    if (!end.present && !drawnAt(timeline, id, atMs)) continue;

    // A target arriving from nothing starts at the pose the from state gives it, placed against
    // the box it is about to land in. This jumps instead of replacing the channels, so that
    // scrubbing back to an earlier exit of the same target still reads that exit.
    if (end.present && !drawnAt(timeline, id, atMs)) {
      const pose = poseValues(box, start);
      for (const name of CHANNELS) {
        retarget(timeline.channels[id]![name], atMs, atMs, pose[name], null, name, spec.settle);
      }
    }

    const goal = poseValues(box, end);
    for (const name of CHANNELS) {
      const sized = GROUP[name] === 'size';
      const { curve, delayMs } =
        sized && !animatesSize(spec, id)
          ? { curve: null, delayMs: 0 }
          : curveFor(transition, rule, id, name, options);
      retarget(timeline.channels[id]![name], atMs, atMs + delayMs, goal[name], curve, name, spec.settle);
    }
  }

  pushMark(timeline, atMs, transition.to, transition.id, rects, null);
  return missing;
}

/**
 * Layout changed with no command: a resize, a content edit, a validation message. Running
 * channels aim at the new endpoint. `snap`, or a channel with no curve, jumps there.
 */
export function applyRemeasure(
  timeline: Timeline,
  atMs: number,
  rects: Rects,
  policy: 'retarget' | 'snap',
): void {
  const { spec } = timeline;
  const mark = markAt(timeline, atMs);
  const running = atMs < mark.settleMs;
  const state = spec.states[mark.state]!;
  let changed = false;

  for (const id of Object.keys(spec.targets)) {
    const pose = state.targets[id]!;
    const rect = rects[id];
    if (!pose.present || !rect) continue;
    const before = timeline.lastRects[id];
    timeline.lastRects[id] = rect;
    if (before && sameBox(before, rect)) continue;
    changed = true;
    const goal: Partial<Record<ChannelName, number>> = {
      x: rect.x + pose.xPx,
      y: rect.y + pose.yPx,
      width: rect.width,
      height: rect.height,
    };
    for (const name of ['x', 'y', 'width', 'height'] as const) {
      const channel = timeline.channels[id]![name];
      const curve = running && policy === 'retarget' ? channel[channel.length - 1]!.curve : null;
      retarget(channel, atMs, atMs, goal[name]!, curve, name, spec.settle);
    }
  }
  if (changed) pushMark(timeline, atMs, mark.state, mark.transitionId, rects, mark.queued);
}

function sameBox(a: Rect, b: Rect) {
  const close = (p: number, q: number) => Math.abs(p - q) < 0.01;
  return close(a.x, b.x) && close(a.y, b.y) && close(a.width, b.width) && close(a.height, b.height);
}

/** The queued command that is due, if any. It runs at the exact settle time. */
export function pendingQueue(timeline: Timeline): { command: string; atMs: number } | null {
  const mark = lastMark(timeline);
  return mark.queued === null ? null : { command: mark.queued, atMs: mark.settleMs };
}

export function sampleTimeline(timeline: Timeline, t: number): Sample {
  const { spec } = timeline;
  const mark = markAt(timeline, t);
  const state = spec.states[mark.state]!;
  const targets: Record<string, TargetSample> = {};
  for (const id of Object.keys(spec.targets)) {
    const channels = timeline.channels[id]!;
    const inFlow = state.targets[id]!.present;
    const exiting = !inFlow && t < (mark.targetSettleMs[id] ?? mark.atMs);
    targets[id] = {
      id,
      inFlow,
      exiting,
      box: mark.rects[id] ?? (exiting ? (timeline.lastRects[id] ?? null) : null),
      x: readChannel(channels.x, t).position,
      y: readChannel(channels.y, t).position,
      width: readChannel(channels.width, t).position,
      height: readChannel(channels.height, t).position,
      opacity: readChannel(channels.opacity, t).position,
      scale: readChannel(channels.scale, t).position,
    };
  }
  return {
    atMs: t,
    state: mark.state,
    transitionId: mark.transitionId,
    animating: t < mark.settleMs,
    targets,
  };
}

/** Position, velocity and target of one channel at t, for the inspector and the tests. */
export function inspectChannel(
  timeline: Timeline,
  id: string,
  name: ChannelName,
  t: number,
): ChannelReading {
  return readChannel(timeline.channels[id]![name], t);
}

/** A live session never scrubs, so everything before the current leg can go. */
export function pruneTimeline(timeline: Timeline, t: number): void {
  for (const channels of Object.values(timeline.channels)) {
    for (const name of CHANNELS) {
      const channel = channels[name];
      let keepFrom = 0;
      for (let i = channel.length - 1; i > 0; i -= 1) {
        if (channel[i]!.startMs <= t) {
          keepFrom = i;
          break;
        }
      }
      if (keepFrom > 0) channel.splice(0, keepFrom);
    }
  }
  while (timeline.marks.length > 1 && timeline.marks[1]!.atMs <= t) timeline.marks.shift();
}

export type TakeEvent =
  | { atMs: number; type: 'command'; command: string; reduced?: boolean; rects?: Rects }
  | { atMs: number; type: 'measure'; rects: Rects }
  | { atMs: number; type: 'props'; patch: Record<string, unknown> };

/** How a replay learns the layout of a state. `at` is a moment in the take. */
export type Geometry = (state: string, at: number) => Rects;

export interface ReplayStep {
  atMs: number;
  command: string;
  outcome: Decision['kind'];
}

/**
 * Rebuilds a timeline from a recorded take. Editing a spring only reruns this, so the same take
 * can be compared under different settings. Queued commands run at their settle time, exactly
 * as they do live.
 */
export function replayTake(
  spec: MotionSpec,
  startMs: number,
  initialRects: Rects,
  events: TakeEvent[],
  geometry: Geometry,
  options: { endMs?: number; reduced?: boolean } = {},
): { timeline: Timeline; steps: ReplayStep[] } {
  const timeline = createTimeline(spec, startMs, initialRects);
  const steps: ReplayStep[] = [];
  const run = (atMs: number, command: string, reduced: boolean) => {
    const decision = decideCommand(timeline, atMs, command);
    const state =
      decision.kind === 'start' ? decision.transition.to : markAt(timeline, atMs).state;
    const rects = decision.kind === 'start' ? geometry(state, atMs) : {};
    applyDecision(timeline, atMs, decision, rects, { reduced });
    steps.push({ atMs, command, outcome: decision.kind });
  };
  const drainQueue = (until: number) => {
    let due = pendingQueue(timeline);
    while (due && due.atMs <= until) {
      run(due.atMs, due.command, options.reduced ?? false);
      due = pendingQueue(timeline);
    }
  };
  for (const event of events) {
    drainQueue(event.atMs);
    if (event.type === 'command') run(event.atMs, event.command, event.reduced ?? options.reduced ?? false);
    if (event.type === 'measure') applyRemeasure(timeline, event.atMs, event.rects, spec.resize);
  }
  drainQueue(options.endMs ?? Number.POSITIVE_INFINITY);
  return { timeline, steps };
}
