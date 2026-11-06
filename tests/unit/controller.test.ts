import { describe, expect, it } from 'vitest';
import { replayTake, sampleTimeline, lastMark, type MotionSpec, type Timeline } from 'frame-studio/pure';
import { mount } from './harness';
import { closedRects, geometry, panelSpec } from './spec-fixture';

/** A spec with one command that toggles, so a queued command has somewhere to go. */
function toggleSpec(policy: 'queue' | 'retarget' = 'queue'): MotionSpec {
  const spec = panelSpec({ commands: ['open', 'close', 'poke', 'toggle'] });
  spec.transitions[0]!.command = 'toggle';
  spec.transitions[1]!.command = 'toggle';
  for (const t of spec.transitions) t.interruptions = [{ command: 'toggle', policy, curve: null }];
  return spec;
}

function send(m: ReturnType<typeof mount>, command: string, t: number) {
  m.clock.set(t);
  m.controller.send(command);
  m.controller.commit();
}

function replayOf(m: ReturnType<typeof mount>, spec: MotionSpec) {
  return replayTake(spec, 1000, closedRects, m.events, geometry);
}

function expectSameEnd(live: Timeline, replayed: Timeline) {
  expect(lastMark(replayed).state).toBe(lastMark(live).state);
  const end = Math.max(lastMark(live).settleMs, lastMark(replayed).settleMs) + 1;
  const a = sampleTimeline(live, end).targets.panel!;
  const b = sampleTimeline(replayed, end).targets.panel!;
  expect(b.height).toBe(a.height);
}

describe('live and replay agree', () => {
  it('on a queued command, without running it twice', () => {
    const spec = toggleSpec();
    const m = mount(spec, geometry);
    send(m, 'toggle', 1100);
    send(m, 'toggle', 1150);
    const settle = lastMark(m.controller.getTimeline()!).settleMs;
    m.clock.frame(settle + 1);
    m.controller.commit();
    expect(m.controller.getState()).toBe('closed');
    expect(m.events.filter((e) => e.type === 'command')).toHaveLength(2);
    const { timeline } = replayOf(m, spec);
    expectSameEnd(m.controller.getTimeline()!, timeline);
  });

  it('when a command lands after a queued one came due but before the frame ran it', () => {
    const spec = toggleSpec();
    const m = mount(spec, geometry);
    send(m, 'toggle', 1100);
    send(m, 'toggle', 1150);
    const settle = lastMark(m.controller.getTimeline()!).settleMs;
    send(m, 'toggle', settle + 5);
    // The queue ran at its settle time, then this command queued behind it. Let that finish too.
    const next = lastMark(m.controller.getTimeline()!).settleMs;
    m.clock.frame(next + 1);
    m.controller.commit();
    expect(m.controller.getState()).toBe('open');
    expectSameEnd(m.controller.getTimeline()!, replayOf(m, spec).timeline);
  });

  it('keeps reduced motion for a queued command', () => {
    const spec = toggleSpec();
    const m = mount(spec, geometry, { reducedMotion: true });
    // With reduced motion nothing runs long, so give it a transition to interrupt.
    spec.transitions[0]!.reducedMotion = { policy: 'fade', durationMs: 300 };
    send(m, 'toggle', 1100);
    send(m, 'toggle', 1150);
    const settle = lastMark(m.controller.getTimeline()!).settleMs;
    m.clock.frame(settle + 1);
    m.controller.commit();
    const { timeline } = replayOf(m, spec);
    const live = sampleTimeline(m.controller.getTimeline()!, settle + 2).targets.panel!;
    expect(sampleTimeline(timeline, settle + 2).targets.panel!.height).toBe(live.height);
  });

  it('takes a layout change found at the settle moment before the queued command', () => {
    const spec = toggleSpec();
    const { timeline, steps } = replayTake(
      spec,
      1000,
      closedRects,
      [
        { atMs: 1100, type: 'command', command: 'toggle' },
        { atMs: 1150, type: 'command', command: 'toggle' },
      ],
      geometry,
    );
    const settle = steps[2]!.atMs;
    const wider = { panel: { x: 0, y: 0, width: 500, height: 260 }, body: geometry('open').body! };
    const second = replayTake(
      spec,
      1000,
      closedRects,
      [
        { atMs: 1100, type: 'command', command: 'toggle' },
        { atMs: 1150, type: 'command', command: 'toggle' },
        { atMs: settle, type: 'measure', rects: wider },
      ],
      geometry,
    );
    expect(lastMark(timeline).state).toBe('closed');
    expect(second.timeline.lastRects.panel!.width).toBe(320);
    const atSettle = second.timeline.marks.findIndex((mark) => mark.transitionId === 'close' && mark.atMs === settle);
    const measured = second.timeline.marks.findIndex((mark) => mark.rects.panel?.width === 500);
    expect(measured).toBeLessThan(atSettle);
  });
});

describe('queue edge cases', () => {
  it('finishes drawing when a queued command is refused', () => {
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [{ command: 'poke', policy: 'queue', curve: null }];
    const m = mount(spec, geometry);
    send(m, 'open', 1100);
    send(m, 'poke', 1150);
    const settle = lastMark(m.controller.getTimeline()!).settleMs;
    m.clock.frame(settle + 1);
    expect(m.elements.panel.style.height).toBeFalsy();
    expect(m.clock.waiting()).toBe(false);
    expect(m.warnings).toHaveLength(1);
  });

  it('does not hang replaying a queued command with nowhere to go', () => {
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [{ command: 'poke', policy: 'queue', curve: null }];
    const { steps } = replayTake(
      spec,
      0,
      closedRects,
      [
        { atMs: 0, type: 'command', command: 'open' },
        { atMs: 50, type: 'command', command: 'poke' },
      ],
      geometry,
    );
    expect(steps.map((s) => s.outcome)).toEqual(['start', 'queue', 'reject']);
  });

  it('keeps a queued command waiting when replay stops before it is due', () => {
    const spec = toggleSpec();
    const { timeline } = replayTake(
      spec,
      1000,
      closedRects,
      [
        { atMs: 1100, type: 'command', command: 'toggle' },
        { atMs: 1150, type: 'command', command: 'toggle' },
      ],
      geometry,
      { endMs: 1200 },
    );
    expect(lastMark(timeline).queued).toBe('toggle');
    expect(lastMark(timeline).state).toBe('open');
  });
});

describe('several commands in one handler', () => {
  it('judges the second from the state the first reached', () => {
    const m = mount(panelSpec(), geometry);
    m.clock.set(1100);
    m.controller.send('open');
    m.controller.send('close');
    m.controller.commit();
    expect(m.warnings).toEqual([]);
    expect(m.controller.getState()).toBe('closed');
  });

  it('toggles twice and lands where it began', () => {
    const m = mount(toggleSpec('retarget'), geometry);
    m.clock.set(1100);
    m.controller.send('toggle');
    m.controller.send('toggle');
    m.controller.commit();
    expect(m.controller.getState()).toBe('closed');
  });
});

describe('recording', () => {
  it('keeps an ignored command in the take, so a rule change can be tried on it', () => {
    const spec = panelSpec();
    spec.transitions[0]!.interruptions = [{ command: '*', policy: 'ignore', curve: null }];
    const m = mount(spec, geometry);
    send(m, 'open', 1100);
    send(m, 'close', 1150);
    expect(m.events.filter((e) => e.type === 'command').map((e: any) => e.command)).toEqual(['open', 'close']);
    const changed = structuredClone(spec);
    changed.transitions[0]!.interruptions = [];
    expect(lastMark(replayTake(changed, 1000, closedRects, m.events, geometry).timeline).state).toBe('closed');
  });
});

describe('lifecycle', () => {
  it('keeps a command sent before the first commit', () => {
    const spec = panelSpec();
    const m = mount(spec, geometry);
    m.controller.reset('closed');
    m.controller.send('open');
    m.controller.commit();
    expect(m.controller.getState()).toBe('open');
  });

  it('attaches when the root arrives after start', () => {
    let observed = 0;
    (globalThis as any).ResizeObserver = class {
      observe() {
        observed += 1;
      }
      disconnect() {}
    };
    const m = mount(panelSpec(), geometry);
    m.controller.setRoot(null);
    m.controller.start();
    expect(observed).toBe(0);
    m.controller.setRoot(m.root);
    expect(observed).toBe(1);
    delete (globalThis as any).ResizeObserver;
  });

  it('picks a waiting queue back up after stop and start', () => {
    const spec = toggleSpec();
    const m = mount(spec, geometry);
    m.controller.start();
    send(m, 'toggle', 1100);
    send(m, 'toggle', 1150);
    m.controller.stop();
    expect(m.clock.waiting()).toBe(false);
    m.controller.start();
    expect(m.clock.waiting()).toBe(true);
  });

  it('does not grow without limit when transitions are instant', () => {
    const spec = panelSpec();
    for (const t of spec.transitions) t.reducedMotion = { policy: 'instant', durationMs: 0 };
    const m = mount(spec, geometry, { reducedMotion: true });
    for (let i = 0; i < 200; i += 1) send(m, i % 2 ? 'close' : 'open', 1100 + i * 10);
    expect(m.controller.getTimeline()!.channels.panel!.height.length).toBeLessThan(4);
  });
});
