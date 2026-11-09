import type { SettleThresholds, SpringCurve } from '../../packages/studio/runtime/spec';
import { springAt, springSettleSeconds } from '../../packages/studio/runtime/spring';

/**
 * A spring from rest, written as a CSS linear() easing and a duration.
 *
 * This is the one part of a spring that CSS can hold: a fixed path from 0 to 1 over a fixed time.
 * It cannot start from a speed, so an interrupted transition that uses it restarts from rest
 * where the runtime would carry on. The page says so beside the string.
 */
export interface LinearEasing {
  durationMs: number;
  stops: { at: number; value: number }[];
  css: string;
}

/** How far the easing may sit from the spring, as a fraction of the distance, before rounding. */
export const LINEAR_TOLERANCE = 0.001;
/** One sample a millisecond at least, so the gaps between samples cannot hide a miss. */
const MIN_SAMPLES = 480;

const trim = (value: number, places: number) => Number(value.toFixed(places)).toString();

export function springToLinear(
  spring: SpringCurve,
  distancePx: number,
  settle: SettleThresholds,
  tolerance = LINEAR_TOLERANCE,
): LinearEasing {
  const seconds = springSettleSeconds(spring, 0, 0, Math.max(1, Math.abs(distancePx)), settle.px, settle.pxPerSecond);
  const durationMs = Math.max(1, Math.round(seconds * 1000));
  const SAMPLES = Math.max(MIN_SAMPLES, durationMs);
  const values = Array.from({ length: SAMPLES + 1 }, (_, i) => springAt(spring, 0, 0, 1, ((i / SAMPLES) * durationMs) / 1000).position);
  values[0] = 0;
  // The runtime lands on its target at the settle time, and so does this.
  values[SAMPLES] = 1;

  // Keep the fewest points whose straight lines stay inside the tolerance at every sample.
  const keep = new Set([0, SAMPLES]);
  const spans: [number, number][] = [[0, SAMPLES]];
  while (spans.length > 0) {
    const [a, b] = spans.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const chord = values[a]! + ((values[b]! - values[a]!) * (i - a)) / (b - a);
      const miss = Math.abs(values[i]! - chord);
      if (miss > worst) {
        worst = miss;
        at = i;
      }
    }
    if (at !== -1 && worst > tolerance) {
      keep.add(at);
      spans.push([a, at], [at, b]);
    }
  }

  const stops = [...keep].sort((a, b) => a - b).map((i) => ({ at: i / SAMPLES, value: values[i]! }));
  const parts = stops.map((stop, i) =>
    i === 0 || i === stops.length - 1 ? trim(stop.value, 4) : `${trim(stop.value, 4)} ${trim(stop.at * 100, 3)}%`,
  );
  return { durationMs, stops, css: `linear(${parts.join(', ')})` };
}

/** Reads a linear() string back into a function of progress, for checking what was written. */
export function readLinear(css: string): (progress: number) => number {
  const body = css.slice(css.indexOf('(') + 1, css.lastIndexOf(')'));
  const stops = body.split(',').map((part) => {
    const [value, at] = part.trim().split(/\s+/);
    return { value: Number(value), at: at === undefined ? null : Number.parseFloat(at) / 100 };
  });
  stops[0]!.at ??= 0;
  stops[stops.length - 1]!.at ??= 1;
  return (progress) => {
    for (let i = 1; i < stops.length; i += 1) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      if (progress <= b.at!) return a.value + ((b.value - a.value) * (progress - a.at!)) / (b.at! - a.at! || 1);
    }
    return stops[stops.length - 1]!.value;
  };
}
