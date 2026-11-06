import { describe, expect, it } from 'vitest';
import {
  applyDecision,
  applyRemeasure,
  createTimeline,
  decideCommand,
  inspectChannel,
  isAnimating,
  lastMark,
  pruneTimeline,
  replayTake,
  readChannel,
  sampleTimeline,
  springAt,
  type Channel,
  type MotionSpec,
  type TakeEvent,
  type Timeline,
} from 'frame-studio/pure';
import { closedRects, geometry, openRects, panelSpec, spring } from './spec-fixture';

function start(spec = panelSpec()) {
  return createTimeline(spec, 0, closedRects);
}

function command(timeline: Timeline, atMs: number, name: string, reduced = false) {
  const decision = decideCommand(timeline, atMs, name);
  const state = decision.kind === 'start' ? decision.transition.to : lastMark(timeline).state;
  applyDecision(timeline, atMs, decision, geometry(state), { reduced });
  return decision;
}

const height = (t: Timeline, at: number) => inspectChannel(t, 'panel', 'height', at);

describe('semantic state', () => {
  it('starts in the initial state, at rest', () => {
    const s = sampleTimeline(start(), 0);
    expect(s.state).toBe('closed');
    expect(s.animating).toBe(false);
    expect(s.targets.body!.inFlow).toBe(false);
  });

  it('rejects a command with no transition and changes nothing', () => {
    const t = start();
    expect(command(t, 10, 'close').kind).toBe('reject');
    expect(sampleTimeline(t, 10).state).toBe('closed');
  });

  it('changes state the instant a command lands, before the motion moves', () => {
    const t = start();
    command(t, 10, 'open');
    expect(sampleTimeline(t, 10).state).toBe('open');
    expect(height(t, 10).position).toBe(60);
  });
});

describe('interruption', () => {
  it('reversal carries position and velocity exactly', () => {
    const t = start();
    command(t, 0, 'open');
    const before = height(t, 120);
    command(t, 120, 'close');
    const after = height(t, 120);
    // Equal to rounding: a new leg recomputes t = 0 through its own closed form.
    expect(Math.abs(after.position - before.position)).toBeLessThan(1e-9);
    expect(Math.abs(after.velocity - before.velocity)).toBeLessThan(1e-9);
    expect(after.target).toBe(60);
    // After the reversal the path is a fresh spring from those values.
    const expected = springAt(spring, before.position, before.velocity, 60, 0.05);
    expect(height(t, 170).position).toBeCloseTo(expected.position, 9);
    expect(height(t, 170).velocity).toBeCloseTo(expected.velocity, 7);
  });

  it('applies the rule on the running transition, not the one being started', () => {
    const stiff = { type: 'spring', stiffness: 900, damping: 60, mass: 1 } as const;
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [{ command: 'close', policy: 'retarget', curve: stiff }];
    const t = start(spec);
    command(t, 0, 'open');
    command(t, 100, 'close');
    expect(height(t, 100).segment.curve).toEqual(stiff);
  });

  it('ignores a command when the rule says so', () => {
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [{ command: '*', policy: 'ignore', curve: null }];
    const t = start(spec);
    command(t, 0, 'open');
    expect(command(t, 50, 'close').kind).toBe('ignore');
    expect(sampleTimeline(t, 60).state).toBe('open');
  });

  it('a queued command runs at the exact settle time', () => {
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [{ command: 'close', policy: 'queue', curve: null }];
    const { timeline, steps } = replayTake(
      spec, 0, closedRects,
      [{ atMs: 0, type: 'command', command: 'open' }, { atMs: 50, type: 'command', command: 'close' }],
      geometry,
    );
    const settleOfOpen = timeline.marks.find((m) => m.transitionId === 'open' && m.queued === 'close')!.settleMs;
    expect(steps.map((s) => s.outcome)).toEqual(['start', 'queue', 'start']);
    expect(steps[2]!.atMs).toBe(settleOfOpen);
    expect(sampleTimeline(timeline, settleOfOpen - 1).state).toBe('open');
    expect(sampleTimeline(timeline, settleOfOpen).state).toBe('closed');
  });

  it('a retarget cancels a delayed leg that had not started', () => {
    const spec = panelSpec();
    spec.transitions[0]!.targets = { panel: { size: { curve: spring, delayMs: 300 } } };
    const t = start(spec);
    command(t, 0, 'open');
    command(t, 100, 'close');
    // The delayed grow never happened, so the height stays put.
    expect(height(t, 100).position).toBe(60);
    expect(height(t, 500).position).toBe(60);
    expect(sampleTimeline(t, 2000).animating).toBe(false);
  });

  it('a delayed retarget keeps following the old leg until it starts', () => {
    const spec = panelSpec();
    spec.transitions[1]!.targets = { panel: { size: { curve: spring, delayMs: 40 } } };
    const t = start(spec);
    command(t, 0, 'open');
    const free = height(t, 130);
    command(t, 100, 'close');
    expect(height(t, 130).position).toBe(free.position);
    expect(height(t, 140).segment.startMs).toBe(140);
  });

  it('a delayed leg starts from where the old leg has reached by then, not where it was', () => {
    const spec = panelSpec();
    spec.transitions[1]!.targets = { panel: { size: { curve: spring, delayMs: 40 } } };
    const t = start(spec);
    command(t, 0, 'open');
    const free = height(t, 140);
    command(t, 100, 'close');
    const leg = height(t, 140);
    expect(Math.abs(leg.segment.from - free.position)).toBeLessThan(1e-9);
    expect(Math.abs(leg.segment.velocity - free.velocity)).toBeLessThan(1e-9);
  });

  it('an overruled delayed leg cannot run, even when the new leg starts later than it would have', () => {
    const spec = panelSpec();
    spec.transitions[0]!.targets = { panel: { size: { curve: spring, delayMs: 200 } } };
    spec.transitions[1]!.targets = { panel: { size: { curve: spring, delayMs: 400 } } };
    const t = start(spec);
    command(t, 0, 'open');
    command(t, 100, 'close');
    // Open's leg would have started at 200. Close overruled it and waits until 500.
    expect(height(t, 300).position).toBe(60);
  });

  it('an exact rule beats a wildcard rule, whatever the order', () => {
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [
      { command: '*', policy: 'ignore', curve: null },
      { command: 'close', policy: 'retarget', curve: null },
    ];
    const t = start(spec);
    command(t, 0, 'open');
    expect(command(t, 50, 'close').kind).toBe('start');
  });

  it('survives many retargets with no time passing', () => {
    const t = start();
    command(t, 0, 'open');
    for (let i = 0; i < 6; i += 1) command(t, 80, i % 2 === 0 ? 'close' : 'open');
    expect(Number.isFinite(height(t, 80).position)).toBe(true);
    expect(sampleTimeline(t, 80).state).toBe('open');
  });
});

describe('time model', () => {
  it('gives the same value however often it is sampled in between', () => {
    // Reading has no side effects, so a dense sampler and a sparse one must agree bit for bit.
    const run = (frames: number[]) => {
      const t = start();
      command(t, 0, 'open');
      let i = 0;
      for (; frames[i]! < 110; i += 1) sampleTimeline(t, frames[i]!);
      command(t, 110, 'close');
      for (; i < frames.length; i += 1) sampleTimeline(t, frames[i]!);
      return t;
    };
    const dense = run(Array.from({ length: 300 }, (_, i) => i));
    const sparse = run([7, 90, 299]);
    for (const at of [7, 90, 110, 150, 299]) {
      expect(height(dense, at).position).toBe(height(sparse, at).position);
    }
  });

  it('prunes without changing what is ahead', () => {
    const t = start();
    command(t, 0, 'open');
    command(t, 100, 'close');
    const before = height(t, 150).position;
    pruneTimeline(t, 120);
    expect(height(t, 150).position).toBe(before);
    expect(t.channels.panel!.height.length).toBe(1);
  });
});

describe('settling', () => {
  it('lands exactly on target with zero velocity at the settle time', () => {
    const t = start();
    command(t, 0, 'open');
    const at = height(t, lastMark(t).settleMs);
    expect(at.position).toBe(260);
    expect(at.velocity).toBe(0);
    const before = height(t, lastMark(t).settleMs - 1);
    expect(before.position).not.toBe(260);
  });
});

describe('presence', () => {
  it('draws an exiting target until its own motion finishes', () => {
    const t = start();
    command(t, 0, 'open');
    command(t, 2000, 'close');
    const soon = sampleTimeline(t, 2010).targets.body!;
    expect(soon.inFlow).toBe(false);
    expect(soon.exiting).toBe(true);
    const settled = lastMark(t).targetSettleMs.body!;
    expect(sampleTimeline(t, settled).targets.body!.exiting).toBe(false);
  });

  it('an entering target starts from the pose of the state it came from', () => {
    const t = start();
    command(t, 0, 'open');
    const body = sampleTimeline(t, 0).targets.body!;
    expect(body.opacity).toBe(0);
    expect(body.y).toBe(72 + 8);
  });

  it('entering again keeps the history of the earlier exit, so it can still be scrubbed', () => {
    const t = start();
    command(t, 0, 'open');
    command(t, 2000, 'close');
    const midExit = sampleTimeline(t, 2040).targets.body!;
    expect(midExit.exiting).toBe(true);
    command(t, 5000, 'open');
    expect(sampleTimeline(t, 2040).targets.body).toEqual(midExit);
    expect(sampleTimeline(t, 5000).targets.body!.opacity).toBe(0);
  });

  it('a target reversed during its exit comes back from where it is', () => {
    const t = start();
    command(t, 0, 'open');
    command(t, 2000, 'close');
    const mid = sampleTimeline(t, 2040).targets.body!;
    command(t, 2040, 'open');
    const back = sampleTimeline(t, 2040).targets.body!;
    expect(Math.abs(back.opacity - mid.opacity)).toBeLessThan(1e-9);
    expect(Math.abs(back.y - mid.y)).toBeLessThan(1e-9);
    expect(back.inFlow).toBe(true);
  });
});

describe('layout changes', () => {
  it('retargets a running channel to the new endpoint, keeping position and speed', () => {
    const t = start();
    command(t, 0, 'open');
    const before = height(t, 100);
    applyRemeasure(t, 100, { ...openRects, panel: { x: 0, y: 0, width: 320, height: 300 } }, 'retarget');
    const after = height(t, 100);
    expect(Math.abs(after.position - before.position)).toBeLessThan(1e-9);
    expect(Math.abs(after.velocity - before.velocity)).toBeLessThan(1e-9);
    expect(after.target).toBe(300);
  });

  it('snap jumps to the new endpoint', () => {
    const t = start();
    command(t, 0, 'open');
    applyRemeasure(t, 100, { ...openRects, panel: { x: 0, y: 0, width: 320, height: 300 } }, 'snap');
    expect(height(t, 100).position).toBe(300);
  });

  it('at rest a new layout is taken at once, with nothing to animate', () => {
    const t = start();
    applyRemeasure(t, 500, { panel: { x: 0, y: 0, width: 200, height: 60 } }, 'retarget');
    expect(inspectChannel(t, 'panel', 'width', 500).position).toBe(200);
    expect(isAnimating(t, 501)).toBe(false);
  });

  it('does nothing when the layout has not moved', () => {
    const t = start();
    command(t, 0, 'open');
    const count = t.marks.length;
    applyRemeasure(t, 100, openRects, 'retarget');
    expect(t.marks.length).toBe(count);
  });
});

describe('missing targets', () => {
  it('reports a target that should exist and leaves the rest running', () => {
    const t = start();
    const decision = decideCommand(t, 0, 'open');
    const missing = applyDecision(t, 0, decision, { panel: openRects.panel! }, { reduced: false });
    expect(missing).toEqual(['body']);
    expect(height(t, 100).target).toBe(260);
  });
});

describe('reduced motion', () => {
  it('reaches the same semantic state with travel skipped and opacity faded', () => {
    const t = start();
    command(t, 0, 'open', true);
    const at = sampleTimeline(t, 0);
    expect(at.state).toBe('open');
    expect(at.targets.panel!.height).toBe(260);
    expect(at.targets.body!.y).toBe(72);
    expect(sampleTimeline(t, 60).targets.body!.opacity).toBeCloseTo(0.5, 9);
    expect(sampleTimeline(t, 120).animating).toBe(false);
  });

  it('the instant policy has nothing left to animate', () => {
    const spec: MotionSpec = panelSpec();
    spec.transitions[0]!.reducedMotion = { policy: 'instant', durationMs: 0 };
    const t = start(spec);
    command(t, 0, 'open', true);
    expect(sampleTimeline(t, 0).animating).toBe(false);
    expect(sampleTimeline(t, 0).targets.body!.opacity).toBe(1);
  });
});

describe('reading before a leg starts', () => {
  it('holds the starting value and does not extrapolate backwards', () => {
    const channel: Channel = [{ startMs: 100, from: 10, velocity: 500, to: 90, curve: spring, settleMs: 900 }];
    expect(readChannel(channel, 50)).toMatchObject({ position: 10, velocity: 0, target: 90 });
  });
});

describe('replay', () => {
  it('rebuilds the live timeline from its events', () => {
    const live = start();
    command(live, 0, 'open');
    command(live, 130, 'close');
    const events: TakeEvent[] = [
      { atMs: 0, type: 'command', command: 'open' },
      { atMs: 130, type: 'command', command: 'close' },
    ];
    const { timeline } = replayTake(panelSpec(), 0, closedRects, events, geometry);
    for (const at of [0, 50, 130, 131, 400]) {
      expect(sampleTimeline(timeline, at)).toEqual(sampleTimeline(live, at));
    }
  });

  it('reports a command that no longer applies after an edit', () => {
    const { steps } = replayTake(panelSpec(), 0, closedRects, [{ atMs: 10, type: 'command', command: 'close' }], geometry);
    expect(steps[0]!.outcome).toBe('reject');
  });
});

