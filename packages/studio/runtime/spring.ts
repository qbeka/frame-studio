import type { SettleThresholds, SpringCurve } from './spec';

export interface Motion {
  position: number;
  /** Units per second. */
  velocity: number;
}

/**
 * Distance of the damping ratio from 1 that is treated as exactly critical. Below this the
 * overdamped form cancels two huge terms. At 1e-8 the root gap is about 1.4e-4 of the natural
 * frequency, so that cancellation still costs under 1e-11, and the critical form differs from
 * the true value by a similar amount. tests/unit/spring.test.ts checks the seam.
 */
const CRITICAL_BAND = 1e-8;

/**
 * Closed-form solution of m d'' + c d' + k d = 0 with d = x - target.
 *
 * Writing w = sqrt(k / m) and z = c / (2 sqrt(k m)), the three damping regimes are:
 *   z < 1: d = e^(-z w t) (d0 cos(wd t) + B sin(wd t)), wd = w sqrt(1 - z^2)
 *   z = 1: d = e^(-w t) (d0 + (v0 + w d0) t)
 *   z > 1: d = c1 e^(r1 t) + c2 e^(r2 t), r = -w (z -+ sqrt(z^2 - 1))
 *
 * Being closed form, the answer at t does not depend on how often it was asked for.
 * That is the property that keeps results independent of browser callback spacing.
 */
export function springAt(
  spring: SpringCurve,
  from: number,
  fromVelocity: number,
  to: number,
  seconds: number,
): Motion {
  const { w, z } = naturalParameters(spring);
  const d0 = from - to;
  const v0 = fromVelocity;
  const t = seconds;

  if (Math.abs(z - 1) < CRITICAL_BAND) {
    const b = v0 + w * d0;
    const e = Math.exp(-w * t);
    return { position: to + e * (d0 + b * t), velocity: e * (b - w * (d0 + b * t)) };
  }

  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const decay = z * w;
    const b = (v0 + decay * d0) / wd;
    const e = Math.exp(-decay * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const d = e * (d0 * cos + b * sin);
    return { position: to + d, velocity: e * ((b * wd - decay * d0) * cos - (d0 * wd + decay * b) * sin) };
  }

  const { r1, r2, c1, c2 } = overdampedTerms(w, z, d0, v0);
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return { position: to + c1 * e1 + c2 * e2, velocity: c1 * r1 * e1 + c2 * r2 * e2 };
}

/**
 * Seconds until this motion stays inside the thresholds for good.
 *
 * Each regime has a simple decreasing upper bound on |d| and |v|, so the answer is conservative:
 * the true path may enter the band a little earlier, never later. Tests pin both directions.
 */
export function springSettleSeconds(
  spring: SpringCurve,
  from: number,
  fromVelocity: number,
  to: number,
  maxPosition: number,
  maxVelocity: number,
): number {
  const { w, z } = naturalParameters(spring);
  const d0 = from - to;
  const v0 = fromVelocity;
  let outside: (t: number) => boolean;
  let scale: number;

  if (Math.abs(z - 1) < CRITICAL_BAND) {
    const b = Math.abs(v0 + w * d0);
    const a = Math.abs(d0);
    outside = (t) => {
      const e = Math.exp(-w * t);
      return (a + b * t) * e > maxPosition || (b + w * (a + b * t)) * e > maxVelocity;
    };
    scale = 1 / w;
  } else if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const decay = z * w;
    const amplitude = Math.hypot(d0, (v0 + decay * d0) / wd);
    outside = (t) => {
      const e = amplitude * Math.exp(-decay * t);
      return e > maxPosition || e * w > maxVelocity;
    };
    scale = 1 / decay;
  } else {
    const { r1, r2, c1, c2 } = overdampedTerms(w, z, d0, v0);
    outside = (t) => {
      const e1 = Math.abs(c1) * Math.exp(r1 * t);
      const e2 = Math.abs(c2) * Math.exp(r2 * t);
      return e1 + e2 > maxPosition || Math.abs(r1) * e1 + Math.abs(r2) * e2 > maxVelocity;
    };
    scale = 1 / Math.abs(r1);
  }

  // The critical bound can rise before it falls, so walk a coarse grid backwards to find the
  // last outside point, then bisect the one interval that holds the final crossing.
  let hi = scale;
  while (outside(hi) && hi < 600) hi *= 2;
  const steps = 64;
  let lo = -1;
  for (let i = steps; i >= 0; i -= 1) {
    if (outside((hi * i) / steps)) {
      lo = (hi * i) / steps;
      break;
    }
  }
  if (lo < 0) return 0;
  let upper = Math.min(hi, lo + hi / steps);
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + upper) / 2;
    if (outside(mid)) lo = mid;
    else upper = mid;
  }
  return upper;
}

/** Facts for the inspector. Overshoot is for a move from rest, as a fraction of the distance. */
export function describeSpring(spring: SpringCurve, settle: SettleThresholds, distance = 100) {
  const { w, z } = naturalParameters(spring);
  const overshoot = z < 1 ? Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z)) : 0;
  const settleMs = springSettleSeconds(spring, 0, 0, distance, settle.px, settle.pxPerSecond) * 1000;
  return { dampingRatio: z, naturalHz: w / (2 * Math.PI), overshoot, settleMs };
}

function naturalParameters({ stiffness, damping, mass }: SpringCurve) {
  return { w: Math.sqrt(stiffness / mass), z: damping / (2 * Math.sqrt(stiffness * mass)) };
}

function overdampedTerms(w: number, z: number, d0: number, v0: number) {
  const root = Math.sqrt(z * z - 1);
  const r1 = -w * (z - root);
  const r2 = -w * (z + root);
  const c1 = (v0 - r2 * d0) / (r1 - r2);
  return { r1, r2, c1, c2: d0 - c1 };
}
