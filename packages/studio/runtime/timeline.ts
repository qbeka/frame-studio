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
  hold,
  readChannel,
  restingChannel,
  retarget,
  type Channel,
  type ChannelName,
  type ChannelReading,
  type Hand,
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
  /** Last known box of every target as of this mark, which is what an exit draws against. */
  known: Rects;
  /** When all channels finish, as known at this mark. */
  settleMs: number;
  /** The same per target. An exiting target stays drawn until its own time. */
  targetSettleMs: Record<string, number>;
  /** A command waiting for settleMs. */
  queued: string | null;
  /** The hand driving the transition, until it lets go. */
  hand: Hand | null;
}

export interface Timeline {
  spec: MotionSpec;
  channels: Record<string, Record<ChannelName, Channel>>;
  /** Last known box of every target. Marks snapshot this so history never changes. */
  lastRects: Rects;
  marks: Mark[];
}

export type Decision =
  | { kind: 'start'; transition: TransitionSpec; rule: InterruptionRule | null; hand?: Hand }
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
    known: { ...rects },
    settleMs: atMs,
    targetSettleMs: {},
    queued: null,
    hand: null,
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

/**
 * Pure: says what a command means at atMs. Nothing changes until `applyDecision`.
 *
 * With `hand`, the command is a hand taking hold: its transition starts whatever is running, and
 * follows the hand instead of its curves. A hand outranks the interruption rules both ways. While
 * one holds on, the next command is the hand letting go with it, so it always leaves from where
 * the hand was, at the hand's speed.
 */
export function decideCommand(timeline: Timeline, atMs: number, command: string, hand?: Hand): Decision {
  const { spec } = timeline;
  const mark = markAt(timeline, atMs);
  const transition = spec.transitions.find((t) => t.from === mark.state && t.command === command);
  if (hand || mark.hand) {
    if (!transition || (hand && mark.hand)) return { kind: 'reject', command, reason: 'no-transition' };
    if (hand) return { kind: 'start', transition, rule: null, hand };
    const held = spec.transitions.find((t) => t.id === mark.transitionId);
    // Only a rule that retargets has a curve to give. Queue and ignore do not apply to a hand.
    const rule = held?.interruptions.find((r) => r.command === command) ?? held?.interruptions.find((r) => r.command === '*');
    return { kind: 'start', transition, rule: rule?.policy === 'retarget' ? rule : null };
  }
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
  hand: Hand | null = null,
) {
  const targetSettleMs: Record<string, number> = {};
  let settleMs = atMs;
  for (const id of Object.keys(timeline.channels)) {
    const settle = latestSettle(timeline.channels[id]!);
    targetSettleMs[id] = settle;
    settleMs = Math.max(settleMs, settle);
  }
  timeline.marks.push({ atMs, state, transitionId, rects: { ...rects }, known: { ...timeline.lastRects }, settleMs, targetSettleMs, queued, hand });
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
  // A hand that lets go does not wait: the delays belong to a transition started from rest.
  const released = mark.hand !== null && !decision.hand;
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
    const before = timeline.lastRects[id];
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
    // Under a hand, progress 0 is this target at rest in the state being left.
    const rest = decision.hand ? poseValues(start.present ? (before ?? box) : box, start) : goal;
    for (const name of CHANNELS) {
      const sized = GROUP[name] === 'size';
      if (decision.hand && !(sized && !animatesSize(spec, id))) {
        hold(timeline.channels[id]![name], atMs, rest[name], goal[name], decision.hand);
        continue;
      }
      const { curve, delayMs } =
        sized && !animatesSize(spec, id)
          ? { curve: null, delayMs: 0 }
          : curveFor(transition, rule, id, name, options);
      retarget(timeline.channels[id]![name], atMs, released ? atMs : atMs + delayMs, goal[name], curve, name, spec.settle);
    }
  }

  pushMark(timeline, atMs, transition.to, transition.id, rects, null, decision.hand ?? null);
  return missing;
}

/**
 * The hand lets go without a command, so the transition it was holding carries on into the state
 * already entered, on its own curves, from the hand's position and speed. Returns false when no
 * hand was holding on.
 */
export function applyRelease(timeline: Timeline, atMs: number, options: ApplyOptions): boolean {
  const mark = markAt(timeline, atMs);
  const transition = mark.hand && timeline.spec.transitions.find((t) => t.id === mark.transitionId);
  if (!transition) return false;
  applyDecision(timeline, atMs, { kind: 'start', transition, rule: null }, mark.rects, options);
  return true;
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
      const last = channel[channel.length - 1]!;
      const curve = running && policy === 'retarget' ? last.curve : null;
      // A leg still waiting on its delay keeps its start. A layout change is not a new command.
      const startMs = curve !== null && last.startMs > atMs ? last.startMs : atMs;
      // A hand keeps hold through a layout change, and now leads to the new endpoint.
      if (last.hand) hold(channel, atMs, last.from, goal[name]!, last.hand.track);
      else retarget(channel, atMs, startMs, goal[name]!, curve, name, spec.settle);
    }
  }
  if (changed) pushMark(timeline, atMs, mark.state, mark.transitionId, rects, mark.queued, mark.hand);
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

/** Takes the queued command off the timeline, because it is about to run or be refused. */
export function clearQueue(timeline: Timeline): void {
  lastMark(timeline).queued = null;
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
      box: mark.rects[id] ?? (exiting ? (mark.known[id] ?? null) : null),
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

/** Adds where the hand is now. Time cannot go back, so a sample at an old moment moves the last one. */
export function moveHand(hand: Hand, atMs: number, progress: number): void {
  const last = hand.times.length - 1;
  if (atMs > hand.times[last]!) {
    hand.times.push(atMs);
    hand.progress.push(progress);
  } else {
    hand.progress[last] = progress;
  }
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
  | { atMs: number; type: 'props'; patch: Record<string, unknown> }
  /** A hand takes hold of the transition `command` starts, at this progress through it. */
  | { atMs: number; type: 'grab'; command: string; progress: number; reduced?: boolean; rects?: Rects }
  | { atMs: number; type: 'drag'; progress: number }
  /** The hand lets go and the transition carries on. Letting go with a command is a `command`. */
  | { atMs: number; type: 'release'; reduced?: boolean };

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
  let queuedReduced = options.reduced ?? false;
  let hand: Hand | null = null;
  const run = (atMs: number, command: string, reduced: boolean, grabbed?: Hand) => {
    const decision = decideCommand(timeline, atMs, command, grabbed);
    const state = decision.kind === 'start' ? decision.transition.to : markAt(timeline, atMs).state;
    const rects = decision.kind === 'start' ? geometry(state, atMs) : {};
    if (decision.kind === 'queue') queuedReduced = reduced;
    applyDecision(timeline, atMs, decision, rects, { reduced });
    steps.push({ atMs, command, outcome: decision.kind });
    hand = lastMark(timeline).hand;
  };
  // A queued command leaves the queue before it runs, so one that is refused cannot loop.
  const drainQueue = (isDue: (atMs: number) => boolean) => {
    let due = pendingQueue(timeline);
    while (due && isDue(due.atMs)) {
      clearQueue(timeline);
      run(due.atMs, due.command, queuedReduced);
      due = pendingQueue(timeline);
    }
  };
  for (const event of events) {
    if (event.type === 'measure') {
      // Live, a layout change found at the settle moment is taken first, so it must be here too.
      drainQueue((atMs) => atMs < event.atMs);
      applyRemeasure(timeline, event.atMs, event.rects, spec.resize);
    } else {
      drainQueue((atMs) => atMs <= event.atMs);
      const reduced = ('reduced' in event ? event.reduced : undefined) ?? options.reduced ?? false;
      if (event.type === 'command') run(event.atMs, event.command, event.reduced ?? options.reduced ?? false);
      else if (event.type === 'grab') run(event.atMs, event.command, reduced, { times: [event.atMs], progress: [event.progress] });
      else if (event.type === 'drag' && hand) moveHand(hand, event.atMs, event.progress);
      else if (event.type === 'release' && applyRelease(timeline, event.atMs, { reduced })) hand = null;
    }
  }
  const endMs = options.endMs ?? Number.POSITIVE_INFINITY;
  drainQueue((atMs) => atMs <= endMs);
  return { timeline, steps };
}
