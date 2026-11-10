import { describe, expect, it } from 'vitest';
import {
  applyDecision,
  applyRelease,
  applyRemeasure,
  createTimeline,
  decideCommand,
  handAt,
  inspectChannel,
  isAnimating,
  lastMark,
  moveHand,
  replayTake,
  sampleTimeline,
  springAt,
  type Hand,
  type MotionSpec,
  type SpringCurve,
  type TakeEvent,
  type Timeline,
} from 'frame-studio/pure';
import { parseProject, serializeProject, type Project } from '../../packages/studio/authoring/project';
import { mount } from './harness';
import { closedRects, geometry, openRects, panelSpec, spring } from './spec-fixture';

const firm: SpringCurve = { type: 'spring', stiffness: 700, damping: 48, mass: 1 };
const height = (t: Timeline, at: number) => inspectChannel(t, 'panel', 'height', at);
const opacity = (t: Timeline, at: number) => inspectChannel(t, 'body', 'opacity', at);

function start(spec = panelSpec()) {
  return createTimeline(spec, 0, closedRects);
}

function command(timeline: Timeline, atMs: number, name: string, reduced = false) {
  const decision = decideCommand(timeline, atMs, name);
  const state = decision.kind === 'start' ? decision.transition.to : lastMark(timeline).state;
  applyDecision(timeline, atMs, decision, geometry(state), { reduced });
  return decision;
}

function grab(timeline: Timeline, atMs: number, name: string, progress: number, reduced = false) {
  const hand: Hand = { times: [atMs], progress: [progress] };
  const decision = decideCommand(timeline, atMs, name, hand);
  if (decision.kind === 'start') applyDecision(timeline, atMs, decision, geometry(decision.transition.to), { reduced });
  return { hand, decision };
}

/** A hand moving at a steady speed, one sample every 8 ms, ending at `untilMs`. */
function steady(hand: Hand, fromMs: number, untilMs: number, perSecond: number) {
  const base = handAt(hand, fromMs).progress;
  for (let t = fromMs + 8; t <= untilMs; t += 8) moveHand(hand, t, base + (perSecond * (t - fromMs)) / 1000);
}

describe('reading a hand', () => {
  it('holds the last sample and reads no speed from a single one', () => {
    const hand: Hand = { times: [100], progress: [0.25] };
    expect(handAt(hand, 100)).toEqual({ progress: 0.25, perSecond: 0 });
    expect(handAt(hand, 90)).toEqual({ progress: 0.25, perSecond: 0 });
  });

  it('reads a steady drag as exactly its speed', () => {
    const hand: Hand = { times: [0], progress: [0] };
    steady(hand, 0, 200, 2.5);
    const now = handAt(hand, 200);
    expect(now.progress).toBeCloseTo(0.5, 12);
    expect(now.perSecond).toBeCloseTo(2.5, 9);
  });

  it('holds its place between samples, so a frame that lands between two reads the earlier one', () => {
    const hand: Hand = { times: [0, 10, 20], progress: [0, 0.1, 0.2] };
    expect(handAt(hand, 19.9).progress).toBe(0.1);
    expect(handAt(hand, 20).progress).toBe(0.2);
  });

  it('reads no speed once the hand has stopped, however fast it was', () => {
    const hand: Hand = { times: [0], progress: [0] };
    steady(hand, 0, 96, 4);
    expect(handAt(hand, 96).perSecond).toBeCloseTo(4, 9);
    expect(handAt(hand, 96 + 49).perSecond).toBeCloseTo(4, 9);
    expect(handAt(hand, 96 + 51).perSecond).toBe(0);
  });

  it('forgets movement older than its window', () => {
    const hand: Hand = { times: [0, 8, 16, 200], progress: [0, 0.2, 0.4, 0.4] };
    expect(handAt(hand, 200).perSecond).toBe(0);
  });

  it('is not swung by one late sample', () => {
    const hand: Hand = { times: [0], progress: [0] };
    steady(hand, 0, 72, 2);
    // The last event arrives 3 ms late with the place it had on time.
    moveHand(hand, 83, 0.16);
    const twoPoint = ((0.16 - 0.144) / (83 - 72)) * 1000;
    expect(Math.abs(handAt(hand, 83).perSecond - 2)).toBeLessThan(Math.abs(twoPoint - 2));
    expect(handAt(hand, 83).perSecond).toBeGreaterThan(1.7);
  });

  it('moves the last sample when time has not advanced', () => {
    const hand: Hand = { times: [10], progress: [0] };
    moveHand(hand, 10, 0.3);
    moveHand(hand, 5, 0.4);
    expect(hand).toEqual({ times: [10], progress: [0.4] });
  });
});

describe('taking hold', () => {
  it('changes state at once and follows the hand exactly', () => {
    const t = start();
    const { hand, decision } = grab(t, 10, 'open', 0);
    expect(decision.kind).toBe('start');
    expect(sampleTimeline(t, 10).state).toBe('open');
    expect(height(t, 10).position).toBe(60);
    moveHand(hand, 30, 0.5);
    expect(height(t, 30).position).toBe(160);
    moveHand(hand, 50, 1.1);
    expect(height(t, 50).position).toBeCloseTo(280, 9);
    moveHand(hand, 70, -0.05);
    expect(height(t, 70).position).toBeCloseTo(50, 9);
  });

  it('brings every channel along, so a target that enters fades with the hand', () => {
    const t = start();
    const { hand } = grab(t, 10, 'open', 0);
    moveHand(hand, 30, 0.25);
    expect(opacity(t, 30).position).toBeCloseTo(0.25, 12);
    expect(inspectChannel(t, 'body', 'y', 30).position).toBeCloseTo(72 + 8 * 0.75, 12);
  });

  it('never settles while the hand holds on', () => {
    const t = start();
    grab(t, 10, 'open', 0);
    expect(lastMark(t).settleMs).toBe(Number.POSITIVE_INFINITY);
    expect(isAnimating(t, 60_000)).toBe(true);
    expect(sampleTimeline(t, 60_000).animating).toBe(true);
  });

  it('reports the hand speed as the channel speed', () => {
    const t = start();
    const { hand } = grab(t, 0, 'open', 0);
    steady(hand, 0, 120, 3);
    expect(height(t, 120).velocity).toBeCloseTo(600, 6);
  });

  it('refuses a second hand, and a command with nowhere to go, and keeps hold through both', () => {
    const t = start();
    const { hand } = grab(t, 10, 'open', 0);
    expect(grab(t, 20, 'close', 0).decision.kind).toBe('reject');
    expect(decideCommand(t, 20, 'poke').kind).toBe('reject');
    moveHand(hand, 30, 0.5);
    expect(lastMark(t).hand).toBe(hand);
    expect(height(t, 30).position).toBe(160);
  });

  it('is refused when the command has no transition from this state', () => {
    const t = start();
    expect(grab(t, 10, 'close', 0).decision.kind).toBe('reject');
    expect(sampleTimeline(t, 10).state).toBe('closed');
  });

  it('outranks a rule that would ignore or queue the command', () => {
    for (const policy of ['ignore', 'queue'] as const) {
      const spec = panelSpec();
      spec.transitions[0]!.interruptions = [{ command: 'close', policy, curve: null }];
      const t = start(spec);
      command(t, 0, 'open');
      expect(decideCommand(t, 80, 'close').kind).toBe(policy);
      const at = height(t, 80).position;
      const { decision } = grab(t, 80, 'close', (260 - at) / 200);
      expect(decision.kind).toBe('start');
      expect(sampleTimeline(t, 80).state).toBe('closed');
      expect(height(t, 80).position).toBeCloseTo(at, 9);
    }
  });
});

describe('catching a transition in flight', () => {
  it('keeps the followed channel exactly where it was', () => {
    const t = start();
    command(t, 0, 'open');
    const before = height(t, 90).position;
    grab(t, 90, 'close', (260 - before) / 200);
    expect(height(t, 90).position).toBeCloseTo(before, 9);
  });

  it('eases a channel that was somewhere else onto the hand, with no jump', () => {
    const spec = panelSpec();
    // The body fades in late, so it lags the panel when the hand arrives.
    spec.transitions[0]!.targets = { body: { opacity: { curve: { type: 'tween', durationMs: 200, easing: [0, 0, 1, 1] }, delayMs: 100 } } };
    const t = start(spec);
    command(t, 0, 'open');
    expect(opacity(t, 100).position).toBe(0);
    const { hand } = grab(t, 100, 'close', 0.5);
    // On the hand's line the body would be at half. It was at nothing, and it does not jump.
    expect(opacity(t, 100).position).toBeCloseTo(0, 12);
    moveHand(hand, 108, 0.5);
    const soon = opacity(t, 108).position;
    expect(soon).toBeGreaterThan(0);
    expect(soon).toBeLessThan(0.5);
    moveHand(hand, 500, 0.5);
    expect(opacity(t, 500).position).toBeCloseTo(0.5, 4);
  });

  it('eases a target that has to come back, starting from nothing', () => {
    const t = start();
    command(t, 0, 'open');
    command(t, 400, 'close');
    // Long after the close, the body has gone. A hand opens it again from part way.
    const settled = lastMark(t).settleMs + 50;
    const { hand } = grab(t, settled, 'open', 0.4);
    expect(sampleTimeline(t, settled).targets.body!.inFlow).toBe(true);
    expect(opacity(t, settled).position).toBeCloseTo(0, 12);
    moveHand(hand, settled + 400, 0.4);
    expect(opacity(t, settled + 400).position).toBeCloseTo(0.4, 4);
  });
});

describe('letting go', () => {
  it('carries on from the hand position and speed, on the transition curve', () => {
    const t = start();
    const { hand } = grab(t, 0, 'open', 0);
    steady(hand, 0, 120, 3);
    const at = height(t, 120);
    expect(applyRelease(t, 120, { reduced: false })).toBe(true);
    expect(lastMark(t).hand).toBeNull();
    expect(sampleTimeline(t, 120).state).toBe('open');
    expect(height(t, 120).position).toBeCloseTo(at.position, 9);
    expect(height(t, 120).velocity).toBeCloseTo(at.velocity, 6);
    const expected = springAt(spring, at.position, at.velocity, 260, 0.05);
    expect(height(t, 170).position).toBeCloseTo(expected.position, 9);
    expect(height(t, 170).velocity).toBeCloseTo(expected.velocity, 6);
    expect(Number.isFinite(lastMark(t).settleMs)).toBe(true);
    expect(height(t, lastMark(t).settleMs).position).toBe(260);
  });

  it('a harder throw from the same place overshoots further', () => {
    const peak = (perSecond: number, forMs: number) => {
      const t = start();
      const { hand } = grab(t, 0, 'open', 0);
      steady(hand, 0, forMs, perSecond);
      expect(height(t, forMs).position).toBeCloseTo(156, 9);
      applyRelease(t, forMs, { reduced: false });
      let highest = 0;
      for (let at = forMs; at < forMs + 1200; at += 2) highest = Math.max(highest, height(t, at).position);
      return highest;
    };
    // Both let go at 0.48 of the way, one at twelve lengths a second and one at just over one.
    expect(peak(12, 40)).toBeGreaterThan(peak(1.2, 400) + 5);
  });

  it('a hand that stopped lets go at rest', () => {
    const t = start();
    const { hand } = grab(t, 0, 'open', 0);
    steady(hand, 0, 120, 3);
    applyRelease(t, 400, { reduced: false });
    expect(height(t, 400).velocity).toBe(0);
    expect(height(t, 400).position).toBeCloseTo(60 + 200 * handAt(hand, 400).progress, 9);
  });

  it('with a command, leaves the other way from the same position and speed', () => {
    const t = start();
    const { hand } = grab(t, 0, 'open', 0);
    steady(hand, 0, 80, 4);
    steady(hand, 80, 160, -5);
    const at = height(t, 160);
    expect(at.velocity).toBeLessThan(0);
    const decision = command(t, 160, 'close');
    expect(decision.kind).toBe('start');
    expect(sampleTimeline(t, 160).state).toBe('closed');
    const expected = springAt(spring, at.position, at.velocity, 60, 0.04);
    expect(height(t, 200).position).toBeCloseTo(expected.position, 9);
    expect(height(t, 200).velocity).toBeCloseTo(expected.velocity, 6);
  });

  it('uses the curve of a rule that retargets, and ignores rules that queue or ignore', () => {
    const run = (policy: 'retarget' | 'queue' | 'ignore') => {
      const spec = panelSpec();
      spec.transitions[0]!.interruptions = [{ command: 'close', policy, curve: firm }];
      const t = start(spec);
      const { hand } = grab(t, 0, 'open', 0);
      steady(hand, 0, 100, 3);
      const at = height(t, 100);
      expect(command(t, 100, 'close').kind).toBe('start');
      return { at, later: height(t, 140).position };
    };
    const retargeted = run('retarget');
    expect(retargeted.later).toBeCloseTo(springAt(firm, retargeted.at.position, retargeted.at.velocity, 60, 0.04).position, 9);
    for (const policy of ['queue', 'ignore'] as const) {
      const other = run(policy);
      expect(other.later).toBeCloseTo(springAt(spring, other.at.position, other.at.velocity, 60, 0.04).position, 9);
    }
  });

  it('does not wait for a delay', () => {
    const spec = panelSpec();
    spec.transitions[0]!.timing = { curve: spring, delayMs: 300 };
    const t = start(spec);
    const { hand } = grab(t, 0, 'open', 0);
    steady(hand, 0, 100, 2);
    const at = height(t, 100).position;
    applyRelease(t, 100, { reduced: false });
    expect(height(t, 150).position).toBeGreaterThan(at + 10);
  });

  it('does nothing when no hand is holding on', () => {
    const t = start();
    command(t, 0, 'open');
    const marks = t.marks.length;
    expect(applyRelease(t, 50, { reduced: false })).toBe(false);
    expect(t.marks.length).toBe(marks);
  });

  it('under reduced motion follows the hand, then lands at once', () => {
    const t = start();
    const { hand } = grab(t, 0, 'open', 0, true);
    moveHand(hand, 40, 0.3);
    expect(height(t, 40).position).toBeCloseTo(120, 9);
    applyRelease(t, 60, { reduced: true });
    expect(height(t, 60).position).toBe(260);
  });
});

describe('a layout change under a hand', () => {
  it('leads the hand to the new endpoint without letting go', () => {
    const t = start();
    const { hand } = grab(t, 0, 'open', 0);
    moveHand(hand, 40, 0.5);
    expect(height(t, 40).position).toBe(160);
    const taller = { ...openRects, panel: { ...openRects.panel!, height: 300 } };
    applyRemeasure(t, 60, taller, 'retarget');
    expect(lastMark(t).hand).toBe(hand);
    // No jump at the change. The hand's line now ends 40 px further on, and the channel joins it.
    expect(height(t, 60).position).toBeCloseTo(160, 9);
    moveHand(hand, 600, 1);
    expect(height(t, 600).position).toBeCloseTo(300, 4);
    applyRelease(t, 700, { reduced: false });
    expect(height(t, lastMark(t).settleMs).position).toBe(300);
  });
});

describe('the controller', () => {
  function drive(m: ReturnType<typeof mount>) {
    m.clock.set(1100);
    expect(m.controller.grab('open', 0)).toBe(true);
    m.controller.commit();
    for (let i = 1; i <= 12; i += 1) {
      m.clock.set(1100 + i * 8);
      m.controller.drag(i * 0.05);
    }
  }

  it('records a grab, each drag and the release, in order', () => {
    const m = mount(panelSpec(), geometry, { history: true });
    drive(m);
    m.clock.set(1200);
    m.controller.release();
    expect(m.events.map((event) => event.type)).toEqual(['grab', ...Array.from({ length: 12 }, () => 'drag'), 'release']);
    expect(m.events[0]).toMatchObject({ atMs: 1100, command: 'open', progress: 0, rects: openRects });
    expect(m.controller.getState()).toBe('open');
    expect(m.controller.isHeld()).toBe(false);
  });

  it('draws the hand at once and keeps a frame coming while it holds on', () => {
    const m = mount(panelSpec(), geometry);
    drive(m);
    expect(m.elements.panel.style.height).toBe('180px');
    expect(m.clock.waiting()).toBe(true);
    m.clock.frame(1300);
    expect(m.clock.waiting()).toBe(true);
  });

  it('replays a throw to exactly what happened live', () => {
    const spec = panelSpec();
    const m = mount(spec, geometry, { history: true });
    drive(m);
    m.clock.set(1204);
    m.controller.release();
    m.clock.set(1290);
    expect(m.controller.grab('close', 0.1)).toBe(true);
    m.controller.commit();
    for (let i = 1; i <= 8; i += 1) {
      m.clock.set(1290 + i * 9);
      m.controller.drag(0.1 + i * 0.07);
    }
    m.clock.set(1370);
    m.controller.send('open');
    m.controller.commit();
    const live = m.controller.getTimeline()!;
    const { timeline } = replayTake(spec, 1000, closedRects, m.events, geometry);
    expect(lastMark(timeline).state).toBe('open');
    for (let at = 1000; at <= lastMark(live).settleMs + 20; at += 3.7) {
      const a = sampleTimeline(live, at);
      const b = sampleTimeline(timeline, at);
      expect(b.state).toBe(a.state);
      expect(b.targets.panel!.height).toBe(a.targets.panel!.height);
      expect(b.targets.body!.opacity).toBe(a.targets.body!.opacity);
      expect(b.targets.body!.y).toBe(a.targets.body!.y);
    }
  });

  it('lets a command take over from the hand, and then ignores the hand', () => {
    const m = mount(panelSpec(), geometry, { history: true });
    drive(m);
    m.clock.set(1200);
    m.controller.send('close');
    m.controller.commit();
    expect(m.controller.isHeld()).toBe(false);
    expect(m.controller.getState()).toBe('closed');
    const count = m.events.length;
    m.controller.drag(0.9);
    m.controller.release();
    expect(m.events.length).toBe(count);
    expect(m.events[count - 1]).toMatchObject({ type: 'command', command: 'close' });
  });

  it('does nothing for a drag or a release with no hand', () => {
    const m = mount(panelSpec(), geometry);
    m.controller.drag(0.5);
    m.controller.release();
    expect(m.events).toEqual([]);
    expect(m.controller.getState()).toBe('closed');
  });

  it('refuses a grab with nowhere to go, and a second one', () => {
    const m = mount(panelSpec(), geometry);
    expect(m.controller.grab('close', 0)).toBe(false);
    expect(m.controller.isHeld()).toBe(false);
    expect(m.controller.grab('open', 0)).toBe(true);
    expect(m.controller.grab('close', 0)).toBe(false);
    expect(m.controller.isHeld()).toBe(true);
  });

  it('handles a grab that is let go of before its commit', () => {
    const spec = panelSpec();
    const m = mount(spec, geometry, { history: true });
    m.clock.set(1100);
    m.controller.grab('open', 0.2);
    m.controller.release();
    m.controller.commit();
    expect(m.events.map((event) => event.type)).toEqual(['grab', 'release', 'measure']);
    // The grab ran against the layout it had, and the commit then corrected where it leads.
    const live = m.controller.getTimeline()!;
    const { timeline } = replayTake(spec, 1000, closedRects, m.events, geometry);
    const settle = Math.max(lastMark(live).settleMs, lastMark(timeline).settleMs);
    expect(Number.isFinite(settle)).toBe(true);
    expect(sampleTimeline(live, settle + 1).targets.panel!.height).toBe(260);
    expect(sampleTimeline(timeline, settle + 1).targets.panel!.height).toBe(260);
    expect(lastMark(live).hand).toBeNull();
  });

  it('stops following a hand once a take is loaded over it', () => {
    const m = mount(panelSpec(), geometry, { history: true });
    drive(m);
    m.controller.load(createTimeline(panelSpec(), 1000, closedRects), 1000);
    expect(m.controller.isHeld()).toBe(false);
  });

  it('keeps hold of nothing after a reset', () => {
    const m = mount(panelSpec(), geometry);
    drive(m);
    m.controller.reset('closed');
    expect(m.controller.isHeld()).toBe(false);
  });
});

describe('a take with a hand in a project file', () => {
  const take = (events: TakeEvent[]): Project => ({
    format: 'frame.project',
    version: 1,
    name: 'Panel',
    spec: panelSpec() as MotionSpec,
    take: { startMs: 0, initialState: 'closed', initialRects: closedRects, initialProps: {}, events },
  });

  it('reads back what it wrote', () => {
    const project = take([
      { atMs: 10, type: 'grab', command: 'open', progress: 0, rects: openRects },
      { atMs: 18, type: 'drag', progress: 0.2 },
      { atMs: 26, type: 'drag', progress: 1.1 },
      { atMs: 30, type: 'release' },
    ]);
    const parsed = parseProject(JSON.parse(serializeProject(project)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.take!.events).toEqual(project.take!.events);
  });

  it('refuses a hand that is nowhere near the transition', () => {
    const parsed = parseProject(JSON.parse(serializeProject(take([{ atMs: 10, type: 'drag', progress: 40 }]))));
    expect(parsed.ok).toBe(false);
  });
});
