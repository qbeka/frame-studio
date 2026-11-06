import type { Motion } from './spring';
import type { TweenCurve } from './spec';

/**
 * CSS cubic-bezier with end points (0,0) and (1,1). x(s) and y(s) are the two component curves.
 * Time gives x, so finding y means inverting x, which is monotonic because x1 and x2 are in [0, 1].
 */
function axis(s: number, a: number, b: number) {
  const c = 1 - s;
  return 3 * c * c * s * a + 3 * c * s * s * b + s * s * s;
}

function axisSlope(s: number, a: number, b: number) {
  const c = 1 - s;
  return 3 * c * c * a + 6 * c * s * (b - a) + 3 * s * s * (1 - b);
}

function solveS(x: number, x1: number, x2: number) {
  let s = x;
  // Newton converges in a few steps except near flat spots, where bisection takes over.
  for (let i = 0; i < 8; i += 1) {
    const error = axis(s, x1, x2) - x;
    if (Math.abs(error) < 1e-9) return s;
    const slope = axisSlope(s, x1, x2);
    if (Math.abs(slope) < 1e-7) break;
    s -= error / slope;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 48; i += 1) {
    if (axis(s, x1, x2) < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

/** Velocity is the true derivative of the curve. A tween cannot start from one, see timeline.ts. */
export function tweenAt(curve: TweenCurve, from: number, to: number, ms: number): Motion {
  const duration = curve.durationMs;
  if (duration <= 0 || ms >= duration) return { position: to, velocity: 0 };
  const [x1, y1, x2, y2] = curve.easing;
  const s = solveS(Math.max(0, ms) / duration, x1, x2);
  const dx = axisSlope(s, x1, x2);
  const slope = dx < 1e-7 ? 0 : axisSlope(s, y1, y2) / dx;
  return {
    position: from + (to - from) * axis(s, y1, y2),
    velocity: ((to - from) * slope) / (duration / 1000),
  };
}
