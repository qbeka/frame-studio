import type { Curve, SettleThresholds } from './spec';
import { springAt, springSettleSeconds, type Motion } from './spring';
import { tweenAt } from './tween';

export type ChannelName = 'x' | 'y' | 'width' | 'height' | 'opacity' | 'scale';

/** One leg of a channel's motion. A null curve means the value jumps to `to` at `startMs`. */
export interface Segment {
  startMs: number;
  from: number;
  /** Speed carried in, units per second. Only springs can honor it. */
  velocity: number;
  to: number;
  curve: Curve | null;
  settleMs: number;
  /** Set while a hand drives this leg. `from` and `to` are where it sits at progress 0 and 1. */
  hand?: { track: Hand; offset: number };
}

export type Channel = Segment[];

/**
 * A hand on the component. Each sample is the progress the hand asked for at that moment, where 0
 * is the state being left and 1 the state being entered. Past either end is allowed. Samples are
 * only ever added, in time order, so an earlier moment always reads the same.
 */
export interface Hand {
  times: number[];
  progress: number[];
}

/** Speed is read from the samples of the last this many milliseconds. */
const HAND_WINDOW_MS = 80;
/** With no sample for this long the hand is holding still, however fast it was moving before. */
const HAND_STILL_MS = 50;
/** A channel caught away from the hand's line joins it over about this long. */
const HAND_BLEND_MS = 40;

/**
 * Where the hand is at t and how fast it is moving, in progress per second. The place is the last
 * sample, held. The speed is the least squares slope of the recent samples, so one late or early
 * pointer event cannot swing it. This is the speed a spring starts with when the hand lets go.
 */
export function handAt(hand: Hand, t: number): { progress: number; perSecond: number } {
  const { times, progress } = hand;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  const last = lo - 1;
  if (last < 0) return { progress: progress[0] ?? 0, perSecond: 0 };
  let first = last;
  while (first > 0 && times[last]! - times[first - 1]! <= HAND_WINDOW_MS) first -= 1;
  if (first === last || t - times[last]! > HAND_STILL_MS) return { progress: progress[last]!, perSecond: 0 };
  let meanT = 0;
  let meanP = 0;
  for (let i = first; i <= last; i += 1) {
    meanT += times[i]!;
    meanP += progress[i]!;
  }
  meanT /= last - first + 1;
  meanP /= last - first + 1;
  let top = 0;
  let bottom = 0;
  for (let i = first; i <= last; i += 1) {
    top += (times[i]! - meanT) * (progress[i]! - meanP);
    bottom += (times[i]! - meanT) ** 2;
  }
  return { progress: progress[last]!, perSecond: bottom > 0 ? (top / bottom) * 1000 : 0 };
}

export interface ChannelReading extends Motion {
  target: number;
  segment: Segment;
}

const isPixels = (name: ChannelName) => name !== 'opacity' && name !== 'scale';

export function thresholdsFor(name: ChannelName, settle: SettleThresholds) {
  return isPixels(name)
    ? { position: settle.px, velocity: settle.pxPerSecond }
    : { position: settle.unit, velocity: settle.unitPerSecond };
}

function evaluate(segment: Segment, t: number): Motion {
  if (t >= segment.settleMs) return { position: segment.to, velocity: 0 };
  const { curve, from, to, velocity, startMs } = segment;
  if (segment.hand) {
    const { progress, perSecond } = handAt(segment.hand.track, t);
    const blend = segment.hand.offset * Math.exp((startMs - t) / HAND_BLEND_MS);
    return {
      position: from + (to - from) * progress + blend,
      velocity: (to - from) * perSecond - (blend * 1000) / HAND_BLEND_MS,
    };
  }
  if (curve === null) return { position: to, velocity: 0 };
  if (curve.type === 'tween') return tweenAt(curve, from, to, t - startMs);
  return springAt(curve, from, velocity, to, (t - startMs) / 1000);
}

/** The segment in charge at t. Later segments have not started, earlier ones were replaced. */
function activeSegment(channel: Channel, t: number): Segment {
  for (let i = channel.length - 1; i > 0; i -= 1) {
    const segment = channel[i]!;
    if (segment.startMs <= t) return segment;
  }
  return channel[0]!;
}

export function readChannel(channel: Channel, t: number): ChannelReading {
  const segment = activeSegment(channel, t);
  // Before a channel's first segment it holds its starting value.
  if (t < segment.startMs) return { position: segment.from, velocity: 0, target: segment.to, segment };
  return { ...evaluate(segment, t), target: segment.to, segment };
}

export function restingChannel(atMs: number, value: number): Channel {
  return [{ startMs: atMs, from: value, velocity: 0, to: value, curve: null, settleMs: atMs }];
}

/**
 * Starts a new leg at startMs from whatever the channel is doing at that moment.
 *
 * `decidedAtMs` is when the command landed. Any leg scheduled after it was waiting on a delay
 * that the new command has overruled, so it never happens. With a delay the channel keeps
 * following its old leg until the new one starts, which is why the start values are read at
 * startMs and not at decidedAtMs.
 */
export function retarget(
  channel: Channel,
  decidedAtMs: number,
  startMs: number,
  to: number,
  curve: Curve | null,
  name: ChannelName,
  settle: SettleThresholds,
): void {
  while (channel.length > 1 && channel[channel.length - 1]!.startMs > decidedAtMs) channel.pop();
  const { position, velocity } = readChannel(channel, startMs);
  const limits = thresholdsFor(name, settle);
  const atRest = Math.abs(position - to) <= limits.position && Math.abs(velocity) <= limits.velocity;
  const finalCurve = atRest ? null : curve;
  channel.push({
    startMs,
    from: position,
    velocity,
    to,
    curve: finalCurve,
    settleMs: startMs + settleDurationMs(finalCurve, position, velocity, to, name, settle),
  });
}

/**
 * Starts a leg that follows a hand: `from` at progress 0, `to` at progress 1. It never settles by
 * itself. A channel that is somewhere else when the hand takes hold, such as a fade caught part
 * way, eases onto the hand's line instead of jumping. When the hand lets go, `retarget` reads this
 * leg's position and speed like any other, so a throw is an ordinary interruption.
 */
export function hold(channel: Channel, atMs: number, from: number, to: number, track: Hand): void {
  while (channel.length > 1 && channel[channel.length - 1]!.startMs > atMs) channel.pop();
  const offset = readChannel(channel, atMs).position - (from + (to - from) * handAt(track, atMs).progress);
  channel.push({ startMs: atMs, from, velocity: 0, to, curve: null, settleMs: Number.POSITIVE_INFINITY, hand: { track, offset } });
}

function settleDurationMs(
  curve: Curve | null,
  from: number,
  velocity: number,
  to: number,
  name: ChannelName,
  settle: SettleThresholds,
): number {
  if (curve === null) return 0;
  if (curve.type === 'tween') return curve.durationMs;
  const limits = thresholdsFor(name, settle);
  return springSettleSeconds(curve, from, velocity, to, limits.position, limits.velocity) * 1000;
}
