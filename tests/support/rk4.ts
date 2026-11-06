/**
 * A second independent check, written to share nothing with the runtime. It integrates the spring
 * equation numerically with fourth order Runge-Kutta at a 0.05 ms step, and knows only the
 * parameters and the endpoints. If preview and export agreed with each other but both had the
 * physics wrong, this is what would notice.
 */
export interface Leg {
  atMs: number;
  to: number;
  stiffness: number;
  damping: number;
  mass: number;
}

const STEP_S = 0.00005;

export function rk4Path(start: number, legs: Leg[], times: number[]): number[] {
  const out: number[] = [];
  let x = start;
  let v = 0;
  let t = 0;
  let index = 0;
  const wanted = [...times].sort((a, b) => a - b);
  let leg: Leg | null = null;
  for (const time of wanted) {
    while (t < time - 1e-9) {
      // Change legs exactly on a command, so no step straddles one.
      const next = legs[index];
      const stop = Math.min(time, next ? next.atMs : Infinity);
      if (next && Math.abs(t - next.atMs) < 1e-9) {
        leg = next;
        index += 1;
        continue;
      }
      if (leg) {
        const { to, stiffness: k, damping: c, mass: m } = leg;
        const a = (p: number, u: number) => (-k * (p - to) - c * u) / m;
        const steps = Math.max(1, Math.ceil((stop - t) / 1000 / STEP_S));
        const h = (stop - t) / 1000 / steps;
        for (let i = 0; i < steps; i += 1) {
          const k1x = v;
          const k1v = a(x, v);
          const k2x = v + (h / 2) * k1v;
          const k2v = a(x + (h / 2) * k1x, k2x);
          const k3x = v + (h / 2) * k2v;
          const k3v = a(x + (h / 2) * k2x, k3x);
          const k4x = v + h * k3v;
          const k4v = a(x + h * k3x, k4x);
          x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
          v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
        }
      }
      t = stop;
    }
    if (legs[index] && Math.abs(t - legs[index]!.atMs) < 1e-9) {
      leg = legs[index]!;
      index += 1;
    }
    out.push(x);
  }
  return out;
}
