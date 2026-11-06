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
}

export type Channel = Segment[];

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
