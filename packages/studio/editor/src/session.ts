import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createController } from '../../runtime/controller';
import { useFrameController } from '../../runtime/react';
import type { MotionSpec, Rects } from '../../runtime/spec';
import { replayTake, type ReplayStep, type TakeEvent, type Timeline } from '../../runtime/timeline';
import type { AnyRegistration, PropValue } from '../../authoring/registration';
import type { Take } from '../../authoring/project';
import { createManualClock } from './manualClock';

export type PropsRecord = Record<string, PropValue>;

/** ?clock=manual gives the browser tests a clock they can step. Nothing else uses it. */
const testClock = new URLSearchParams(location.search).get('clock') === 'manual' ? createManualClock() : null;
if (testClock) (window as unknown as { __frameClock: unknown }).__frameClock = testClock;

export function defaultProps(registration: AnyRegistration): PropsRecord {
  const props: PropsRecord = {};
  for (const [name, definition] of Object.entries(registration.props)) props[name] = definition.default;
  return props;
}

/** The value of every declared prop at time t in a take. */
export function propsAt(take: Take, t: number): PropsRecord {
  const props = { ...take.initialProps };
  for (const event of take.events) {
    if (event.atMs > t) break;
    if (event.type === 'props') Object.assign(props, event.patch);
  }
  return props;
}

/** The moments a take covers, with a little air on both sides. */
export function takeRange(take: Take, timeline: Timeline, now = 0) {
  const first = take.events.find((e) => e.type === 'command');
  const start = (first?.atMs ?? take.startMs) - 60;
  const mark = timeline.marks[timeline.marks.length - 1]!;
  const last = take.events[take.events.length - 1]?.atMs ?? start;
  return { start, end: Math.max(mark.settleMs, last, now) + 60 };
}

/** Lets the playhead move every frame without rendering the whole app. */
function createPlayhead() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: number) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function usePlayhead(session: { playhead: ReturnType<typeof createPlayhead> }) {
  return useSyncExternalStore(session.playhead.subscribe, session.playhead.get);
}

function presenceKey(spec: MotionSpec) {
  return Object.values(spec.states)
    .map((s) => Object.values(s.targets).map((v) => (v.present ? 1 : 0)).join(''))
    .join(',');
}

export type Mode = 'live' | 'inspect' | 'playing';

export interface SessionOptions {
  registration: AnyRegistration;
  spec: MotionSpec;
  take: Take | null;
  setTake: (take: Take | null, group?: string | null) => void;
  /** Measures any state and props without touching the live component. */
  probe: (state: string, props: PropsRecord) => Rects;
}

/**
 * The live component and the take it produces. There are two modes.
 *
 * Live: time runs, input works, and each command is appended to the take.
 * Inspect: time is frozen, input is off, and the component shows whatever the timeline says at the
 * playhead. Leaving inspect is always an explicit choice between `continueFromHere` and `resetTo`.
 */
export function useSession({ registration, spec, take, setTake, probe }: SessionOptions) {
  const latest = useRef({ take, setTake, spec, probe });
  latest.current = { take, setTake, spec, probe };

  const [warnings, setWarnings] = useState<string[]>([]);
  const [props, setPropsState] = useState<PropsRecord>(() => take?.initialProps ?? defaultProps(registration));
  const [mode, setModeState] = useState<Mode>('live');
  const [generation, setGeneration] = useState({ key: 0, state: take?.initialState ?? spec.initialState });
  const [steps, setSteps] = useState<ReplayStep[]>([]);
  const [replayed, setReplayed] = useState<Timeline | null>(null);
  const playhead = useMemo(createPlayhead, []);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modeRef = useRef(mode);
  const setMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);
  const probed = useRef(new Map<string, Rects>());
  const stopPlaying = useRef<(() => void) | null>(null);

  const baseTake = useCallback(
    (now: { startMs: number; rects: Rects }): Take => ({
      startMs: now.startMs,
      initialState: generation.state,
      initialRects: now.rects,
      initialProps: propsRef.current,
      events: [],
    }),
    [generation.state],
  );

  const controller = useMemo(() => {
    const created = createController(
      { ...spec, initialState: generation.state },
      {
        history: true,
        ...(testClock ? { clock: testClock } : {}),
        onWarning(warning) {
          const text =
            warning.code === 'rejected-command'
              ? `"${warning.command}" has no transition from ${warning.state}.`
              : `${warning.code}: ${warning.targets.join(', ')}`;
          setWarnings((current) => [...current.slice(-2), text]);
        },
        onEvent(event: TakeEvent, startMs) {
          const { take: current, setTake: store } = latest.current;
          const rects = created.getTimeline()!.marks[0]!.rects;
          const base = current ?? baseTake({ startMs, rects });
          store({ ...base, events: [...base.events, event] });
          setReplayed(null);
        },
      },
    );
    return created;
    // A new generation is a fresh component and a fresh controller. Spec edits go through setSpec.
  }, [registration, generation, baseTake]);

  const frame = useFrameController(controller, spec);

  useEffect(() => {
    let id = 0;
    const follow = () => {
      if (modeRef.current === 'live') playhead.set(controller.now());
      id = requestAnimationFrame(follow);
    };
    id = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(id);
  }, [controller, playhead]);

  const setProps = useCallback(
    (patch: PropsRecord) => {
      setPropsState((current) => ({ ...current, ...patch }));
      if (modeRef.current !== 'live') return;
      const timeline = controller.getTimeline();
      if (!timeline) return;
      const { take: current, setTake: store } = latest.current;
      const base = current ?? baseTake({ startMs: controller.getStartMs(), rects: timeline.marks[0]!.rects });
      store({ ...base, events: [...base.events, { atMs: controller.now(), type: 'props', patch }] }, 'typing');
    },
    [baseTake, controller],
  );

  /**
   * Layout of a state at a moment in a take. A recorded command brings its own boxes, unless an
   * edit changed which targets are in flow. Anything else is measured by the probe, once.
   */
  const geometryFor = useCallback((nextTake: Take, nextSpec: MotionSpec) => {
    return (state: string, at: number) => {
      const inFlow = Object.keys(nextSpec.targets).filter((id) => nextSpec.states[state]!.targets[id]!.present);
      for (const event of nextTake.events) {
        if (event.type !== 'command' || event.atMs !== at || !event.rects) continue;
        const keys = Object.keys(event.rects);
        if (keys.length === inFlow.length && inFlow.every((id) => event.rects![id])) return event.rects;
      }
      const stateProps = propsAt(nextTake, at);
      const key = `${state}|${presenceKey(nextSpec)}|${JSON.stringify(stateProps)}`;
      let rects = probed.current.get(key);
      if (!rects) {
        rects = latest.current.probe(state, stateProps);
        probed.current.set(key, rects);
      }
      return rects;
    };
  }, []);

  const replay = useCallback(
    (nextTake: Take, nextSpec: MotionSpec) =>
      replayTake(
        { ...nextSpec, initialState: nextTake.initialState },
        nextTake.startMs,
        nextTake.initialRects,
        nextTake.events,
        geometryFor(nextTake, nextSpec),
      ),
    [geometryFor],
  );

  /** Rebuilds the timeline from the take and shows it frozen at t. Every edit ends here. */
  const inspectAt = useCallback(
    (nextTake: Take, nextSpec: MotionSpec, t: number) => {
      stopPlaying.current?.();
      const { timeline, steps: replaySteps } = replay(nextTake, nextSpec);
      controller.setSpec({ ...nextSpec, initialState: nextTake.initialState });
      setPropsState(propsAt(nextTake, t));
      controller.load(timeline, t);
      setSteps(replaySteps);
      setReplayed(timeline);
      playhead.set(t);
      setMode('inspect');
      return timeline;
    },
    [controller, playhead, replay, setMode],
  );

  const seek = useCallback(
    (t: number) => {
      const { take: current } = latest.current;
      if (!current) return;
      setPropsState(propsAt(current, t));
      controller.seek(t);
      playhead.set(t);
    },
    [controller, playhead],
  );

  const pause = useCallback(() => {
    const { take: current, spec: currentSpec } = latest.current;
    if (!current) return;
    if (modeRef.current === 'playing') {
      stopPlaying.current?.();
      setMode('inspect');
      return;
    }
    inspectAt(current, currentSpec, playhead.get());
  }, [inspectAt, playhead, setMode]);

  /** Plays the take back at real speed. The take is not changed and input stays off. */
  const play = useCallback(() => {
    const { take: current, spec: currentSpec } = latest.current;
    if (!current) return;
    const timeline = inspectAt(current, currentSpec, playhead.get());
    const range = takeRange(current, timeline);
    let t = playhead.get() >= range.end - 1 ? range.start : playhead.get();
    let last = performance.now();
    let id = 0;
    const step = () => {
      const time = performance.now();
      t = Math.min(range.end, t + (time - last));
      last = time;
      seek(t);
      if (t >= range.end) {
        stopPlaying.current = null;
        setMode('inspect');
        return;
      }
      id = requestAnimationFrame(step);
    };
    stopPlaying.current = () => {
      cancelAnimationFrame(id);
      stopPlaying.current = null;
    };
    setMode('playing');
    id = requestAnimationFrame(step);
  }, [inspectAt, playhead, seek, setMode]);

  /** Back to a known endpoint, with a new take. */
  const resetTo = useCallback(
    (state: string) => {
      stopPlaying.current?.();
      registration.reset();
      latest.current.setTake(null);
      probed.current.clear();
      setPropsState(defaultProps(registration));
      setReplayed(null);
      setSteps([]);
      setMode('live');
      setGeneration((g) => ({ key: g.key + 1, state }));
    },
    [registration, setMode],
  );

  /** Keeps the take up to the playhead, then lets time run from exactly there, speed intact. */
  const continueFromHere = useCallback(() => {
    const { take: current, spec: currentSpec, setTake: store } = latest.current;
    if (!current) return;
    const t = playhead.get();
    const kept: Take = { ...current, events: current.events.filter((e) => e.atMs <= t) };
    store(kept);
    inspectAt(kept, currentSpec, t);
    controller.resume();
    setReplayed(null);
    setMode('live');
  }, [controller, inspectAt, playhead, setMode]);

  // With no take yet, an edit applies to the resting component straight away.
  useEffect(() => {
    if (latest.current.take || !controller.getTimeline()) return;
    controller.setSpec({ ...spec, initialState: generation.state });
    controller.reset(controller.getState());
  }, [controller, spec, generation.state]);

  return {
    controller,
    frame,
    props,
    setProps,
    mode,
    generation,
    steps,
    playhead,
    warnings,
    replayed,
    replay,
    inspectAt,
    seek,
    pause,
    play,
    resetTo,
    continueFromHere,
    timeline: () => replayed ?? controller.getTimeline(),
  };
}

export type Session = ReturnType<typeof useSession>;
