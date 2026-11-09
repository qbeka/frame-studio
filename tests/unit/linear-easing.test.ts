import { describe, expect, it } from 'vitest';
import { springAt } from '../../packages/studio/runtime/spring';
import type { SpringCurve } from '../../packages/studio/runtime/spec';
import { readLinear, springToLinear } from '../../site/src/linearEasing';

const settle = { px: 0.1, pxPerSecond: 5, unit: 0.001, unitPerSecond: 0.05 };
const spring = (stiffness: number, damping: number, mass = 1): SpringCurve => ({ type: 'spring', stiffness, damping, mass });

/** The page's four presets, then the corners and middle of its two sliders. */
const SPRINGS = [
  spring(420, 34),
  spring(700, 48),
  spring(170, 24),
  spring(520, 20),
  ...[60, 300, 1000].flatMap((stiffness) => [8, 30, 80].map((damping) => spring(stiffness, damping))),
];

/** The page says the easing stays within this fraction of the distance, after rounding. */
const STATED = 0.002;

function worstMiss(curve: SpringCurve, distance: number) {
  const easing = springToLinear(curve, distance, settle);
  const read = readLinear(easing.css);
  let worst = 0;
  // The last instant is left out: there the runtime snaps to its target and so does the easing.
  for (let i = 0; i < 2000; i += 1) {
    const progress = i / 2000;
    const exact = springAt(curve, 0, 0, 1, (progress * easing.durationMs) / 1000).position;
    worst = Math.max(worst, Math.abs(read(progress) - exact));
  }
  return { worst, easing };
}

describe('a spring written as CSS linear()', () => {
  it('stays within the stated distance of the closed form, for every preset and slider corner', () => {
    for (const curve of SPRINGS) {
      for (const distance of [40, 208, 900]) {
        const { worst } = worstMiss(curve, distance);
        expect(worst, `${curve.stiffness}/${curve.damping} over ${distance} px`).toBeLessThan(STATED);
      }
    }
  });

  it('starts at 0, ends at 1 and lasts as long as the runtime takes to settle', () => {
    const { easing } = worstMiss(spring(420, 34), 208);
    expect(easing.css.startsWith('linear(0, ')).toBe(true);
    expect(easing.css.endsWith(', 1)')).toBe(true);
    expect(easing.durationMs).toBeGreaterThan(300);
    expect(easing.durationMs).toBeLessThan(900);
    const last = springAt(spring(420, 34), 0, 0, 208, easing.durationMs / 1000).position;
    expect(Math.abs(last - 208)).toBeLessThanOrEqual(0.1);
  });

  it('keeps an overshoot, which a cubic bezier with y inside 0 and 1 could not', () => {
    const { easing } = worstMiss(spring(520, 20), 208);
    expect(Math.max(...easing.stops.map((stop) => stop.value))).toBeGreaterThan(1.05);
  });

  it('stays short enough to paste', () => {
    for (const curve of SPRINGS) {
      const { easing } = worstMiss(curve, 208);
      expect(easing.css.length).toBeLessThan(curve.damping < 20 ? 2800 : 900);
      expect(easing.stops.every((stop, i) => i === 0 || stop.at > easing.stops[i - 1]!.at)).toBe(true);
    }
  });

  it('would miss the stated distance if the points were thinned further', () => {
    // A bracketing control: the check above has to be able to fail.
    const loose = springToLinear(spring(520, 20), 208, settle, 0.02);
    const read = readLinear(loose.css);
    let worst = 0;
    for (let i = 0; i < 2000; i += 1) {
      const progress = i / 2000;
      worst = Math.max(worst, Math.abs(read(progress) - springAt(spring(520, 20), 0, 0, 1, (progress * loose.durationMs) / 1000).position));
    }
    expect(worst).toBeGreaterThan(STATED);
  });
});
