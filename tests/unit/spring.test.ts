import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  describeSpring,
  retarget,
  readChannel,
  restingChannel,
  springAt,
  springSettleSeconds,
  tweenAt,
  type SpringCurve,
} from '@frame-studio/runtime/pure';

const reference = JSON.parse(readFileSync(new URL('../../reference/spring-reference.json', import.meta.url), 'utf8'));
const curve = (name: string): SpringCurve => ({ type: 'spring', ...reference.springs[name] });
const settle = { px: 0.1, pxPerSecond: 5, unit: 0.001, unitPerSecond: 0.05 };

describe('closed form against the matrix exponential reference', () => {
  it('matches every reference point in all three regimes and at the critical seam', () => {
    expect(reference.points).toHaveLength(280);
    for (const p of reference.points) {
      const got = springAt(curve(p.spring), p.from, p.velocityIn, p.to, p.ms / 1000);
      const context = `${p.spring} from ${p.from} at ${p.ms}ms`;
      expect(Math.abs(got.position - p.position), context).toBeLessThan(1e-6);
      expect(Math.abs(got.velocity - p.velocity), context).toBeLessThan(1e-4);
    }
  });

  it('settle time is never before the last point the true path is outside the band', () => {
    expect(reference.settle).toHaveLength(28);
    for (const c of reference.settle) {
      const ms = 1000 * springSettleSeconds(curve(c.spring), c.from, c.velocityIn, c.to, c.px, c.pxPerSecond);
      expect(ms, `${c.spring} from ${c.from}`).toBeGreaterThanOrEqual(c.lastOutsideMs);
    }
  });

  it('settle time stays close to the true time, so the bound is not uselessly loose', () => {
    let worst = 0;
    for (const c of reference.settle) {
      if (c.lastOutsideMs < 0) continue;
      const ms = 1000 * springSettleSeconds(curve(c.spring), c.from, c.velocityIn, c.to, c.px, c.pxPerSecond);
      const period = (2 * Math.PI) / Math.sqrt(reference.springs[c.spring].stiffness / reference.springs[c.spring].mass);
      worst = Math.max(worst, (ms - c.lastOutsideMs) / (period * 1000));
    }
    // Conservative by less than one natural period in the worst reference case.
    expect(worst).toBeLessThan(1);
  });

  for (const sequence of reference.sequences) {
    it(`keeps position and speed through: ${sequence.name}`, () => {
      const channel = restingChannel(-1, sequence.start);
      for (const leg of sequence.legs) retargetAt(channel, leg);
      const legs = sequence.legs;
      for (const s of sequence.samples) {
        // Read each sample as it would have been read live, before later legs existed.
        const live = restingChannel(-1, sequence.start);
        for (const leg of legs) if (leg.atMs <= s.ms) retargetAt(live, leg);
        const got = readChannel(live, s.ms);
        expect(Math.abs(got.position - s.position), `${s.ms}ms`).toBeLessThan(0.1 + 1e-6);
        const settled = got.velocity === 0 && got.position === got.target;
        if (!settled) {
          expect(Math.abs(got.position - s.position), `${s.ms}ms`).toBeLessThan(1e-6);
          expect(Math.abs(got.velocity - s.velocity), `${s.ms}ms`).toBeLessThan(1e-4);
        }
        // A finished read of history must agree with the live read.
        expect(readChannel(channel, s.ms).position).toBe(got.position);
      }
    });
  }

  function retargetAt(channel: ReturnType<typeof restingChannel>, leg: { atMs: number; to: number; spring: string }) {
    retarget(channel, leg.atMs, leg.atMs, leg.to, curve(leg.spring), 'x', settle);
  }
});

describe('spring facts', () => {
  it('computes the textbook overshoot and damping ratio', () => {
    const c: SpringCurve = { type: 'spring', stiffness: 400, damping: 20, mass: 1 };
    const facts = describeSpring(c, settle);
    expect(facts.dampingRatio).toBeCloseTo(0.5, 12);
    expect(facts.overshoot).toBeCloseTo(0.16303, 4);
    expect(facts.naturalHz).toBeCloseTo(20 / (2 * Math.PI), 10);
  });

  it('reports no overshoot at or above critical damping', () => {
    expect(describeSpring({ type: 'spring', stiffness: 400, damping: 40, mass: 1 }, settle).overshoot).toBe(0);
    expect(describeSpring({ type: 'spring', stiffness: 400, damping: 90, mass: 1 }, settle).overshoot).toBe(0);
  });

  it('returns zero for a motion already inside the band', () => {
    expect(springSettleSeconds(curve('critical'), 5, 0, 5, 0.1, 5)).toBe(0);
  });
});

describe('tween', () => {
  it('holds its endpoints and matches a known cubic-bezier value', () => {
    const c = { type: 'tween', durationMs: 200, easing: [0.25, 0.1, 0.25, 1] } as const;
    expect(tweenAt(c, 0, 100, 0).position).toBeCloseTo(0, 9);
    expect(tweenAt(c, 0, 100, 200).position).toBe(100);
    // CSS `ease` at half the time is about 80.24 percent of the distance.
    expect(tweenAt(c, 0, 100, 100).position).toBeCloseTo(80.24, 1);
  });

  it('reports a velocity that agrees with a finite difference', () => {
    const c = { type: 'tween', durationMs: 300, easing: [0.2, 0, 0, 1] } as const;
    const h = 0.001;
    const numeric = ((tweenAt(c, 0, 80, 120 + h).position - tweenAt(c, 0, 80, 120 - h).position) / (2 * h)) * 1000;
    expect(tweenAt(c, 0, 80, 120).velocity).toBeCloseTo(numeric, 3);
  });

  it('does not let the linear easing drift', () => {
    const c = { type: 'tween', durationMs: 100, easing: [0, 0, 1, 1] } as const;
    expect(tweenAt(c, 10, 20, 37).position).toBeCloseTo(13.7, 8);
  });
});
