import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createController } from '../../runtime/controller';
import { useFrameController } from '../../runtime/react';
import type { MotionSpec, Rects } from '../../runtime/spec';
import { replayTake, sampleTimeline, type ReplayStep, type Timeline } from '../../runtime/timeline';
import type { AnyRegistration, PropValue } from '../../authoring/registration';
import type { Take } from '../../authoring/project';

export type PropsRecord = Record<string, PropValue>;

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

/** The first and last moments a take cares about, with a little air before the first command. */
export function takeRange(take: Take, timeline: Timeline) {
  const first = take.events.find((e) => e.type === 'command');
  const start = first ? first.atMs - 60 : take.startMs;
  const mark = timeline.marks[timeline.marks.length - 1]!;
  const last = take.events[take.events.length - 1]?.atMs ?? start;
  return { start, end: Math.max(mark.settleMs, last) + 60 };
}

/** Small store so that the playhead can move every frame without rendering the whole app. */
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
      return () => listeners.delete(listener);
    },
  };
}

export function usePlayhead(session: { playhead: ReturnType<typeof createPlayhead> }) {
  return useSyncExternalStore(session.playhead.subscribe, session.playhead.get);
}

/** Key for a layout: state, what is in flow, and the content that can change the layout. */
function geometryKey(spec: MotionSpec, state: string, props: PropsRecord) {
  const present = Object.values(spec.states).map((s) => Object.values(s.targets).map((v) => (v.present ? 1 : 0)).join(''));
  return `${state}|${present.join(',')}|${JSON.stringify(props)}`;
}

export type Mode = 'live' | 'inspect' | 'playing';

export interface SessionOptions {
  registration: AnyRegistration;
  spec: MotionSpec;
  take: Take | null;
  setTake: (take: Take | null, group?: string | null) => void;
  /** Measures the layout of any state and props, without touching the live component. */
  probe: (state: string, props: PropsRecord) => Rects;
}

export function useSession({ registration, spec, take, setTake, probe }: SessionOptions) {
  const options = useRef({ take, setTake, spec, probe });
  options.current = { take, setTake, spec, probe };

  const [warnings, setWarnings] = useState<string[]>([]);
  const [props, setPropsState] = useState<PropsRecord>(() => take?.initialProps ?? defaultProps(registration));
  const [mode, setMode] = useState<Mode>('live');
  const [resetKey, setResetKey] = useState(0);
  const [steps, setSteps] = useState<ReplayStep[]>([]);
  const [replayed, setReplayed] = useState<Timeline | null>(null);
  const playhead = useMemo(createPlayhead, []);
  const propsRef = useRef(props);
  propsRef.current = props;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const geometry = useRef(new Map<string, Rects>());

  const controller = useMemo(
    () =>
      createController(spec, {
        history: true,
        onWarning(warning) {
          const text =
            warning.code === 'rejected-command'
              ? `"${warning.command}" has no transition from ${warning.state}.`
              : `${warning.code}: ${warning.targets.join(', ')}`;
          setWarnings((current) => [...current.slice(-3), text]);
        },
        onEvent(event, startMs) {
          const { take: current, setTake: store, spec: currentSpec } = options.current;
          if (event.type === 'command' && event.rects) {
            geometry.current.set(geometryKey(currentSpec, controller.getState(), propsRef.current), event.rects);
          }
          const initial = controller.getTimeline()!.marks[0]!;
          const base: Take = current ?? {
            startMs,
            initialRects: initial.rects,
            initialProps: propsRef.current,
            events: [],
          };
          store({ ...base, events: [...base.events, event] });
          setReplayed(null);
        },
      }),
    // A new reset key means a fresh component and a fresh controller.
    [registration, resetKey],
  );

  const frame = useFrameController(controller, spec);

  useEffect(() => {
    let cancel = 0;
    const follow = () => {
      if (modeRef.current === 'live') playhead.set(controller.now());
      cancel = requestAnimationFrame(follow);
    };
    cancel = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(cancel);
  }, [controller, playhead]);

  const setProps = useCallback(
    (patch: PropsRecord) => {
      setPropsState((current) => ({ ...current, ...patch }));
      if (modeRef.current !== 'live') return;
      const { take: current, setTake: store } = options.current;
      const timeline = controller.getTimeline();
      if (!timeline) return;
      const base: Take = current ?? {
        startMs: controller.getStartMs(),
        initialRects: timeline.marks[0]!.rects,
        initialProps: propsRef.current,
        events: [],
      };
      store({ ...base, events: [...base.events, { atMs: controller.now(), type: 'props', patch }] }, 'typing');
    },
    [controller],
  );

  /** Layout of a state at a moment in the take: recorded if known, otherwise measured now. */
  const geometryFor = useCallback((nextTake: Take, nextSpec: MotionSpec) => {
    return (state: string, at: number) => {
      const props = propsAt(nextTake, at);
      const key = geometryKey(nextSpec, state, props);
      let rects = geometry.current.get(key);
      if (!rects) {
        rects = options.current.probe(state, props);
        geometry.current.set(key, rects);
      }
      return rects;
    };
  }, []);

  /** Rebuilds the timeline from the take and shows it at t. Everything that edits ends here. */
  const inspectAt = useCallback(
    (nextTake: Take, nextSpec: MotionSpec, t: number) => {
      const { timeline, steps: replaySteps } = replayTake(
        nextSpec,
        nextTake.startMs,
        nextTake.initialRects,
        nextTake.events,
        geometryFor(nextTake, nextSpec),
      );
      controller.setSpec(nextSpec);
      setPropsState(propsAt(nextTake, t));
      controller.load(timeline, t);
      setSteps(replaySteps);
      setReplayed(timeline);
      playhead.set(t);
      setMode('inspect');
      return timeline;
    },
    [controller, geometryFor, playhead],
  );

  const seek = useCallback(
    (t: number) => {
      const { take: current } = options.current;
      if (!current) return;
      setPropsState(propsAt(current, t));
      controller.seek(t);
      playhead.set(t);
    },
    [controller, playhead],
  );

  const pause = useCallback(() => {
    const { take: current, spec: currentSpec } = options.current;
    if (!current) return;
    inspectAt(current, currentSpec, playhead.get());
  }, [inspectAt, playhead]);

  /** Starts over from the initial state, with a new take. */
  const reset = useCallback(() => {
    registration.reset();
    options.current.setTake(null);
    geometry.current.clear();
    setPropsState(defaultProps(registration));
    setReplayed(null);
    setSteps([]);
    setMode('live');
    setResetKey((k) => k + 1);
  }, [registration]);

  /** Keeps the take up to the playhead and lets time run again from exactly there. */
  const continueFromHere = useCallback(() => {
    const { take: current, spec: currentSpec, setTake: store } = options.current;
    if (!current) return;
    const t = playhead.get();
    const kept: Take = { ...current, events: current.events.filter((e) => e.atMs <= t) };
    store(kept);
    inspectAt(kept, currentSpec, t);
    controller.resume();
    setMode('live');
  }, [controller, inspectAt, playhead]);

  useEffect(() => {
    // No take yet: a spec edit applies to a fresh timeline. With a take, the panel calls inspect.
    if (controller.getTimeline() && !options.current.take) {
      controller.setSpec(spec);
      controller.reset(controller.getState());
    }
  }, [controller, spec]);

  const sample = useCallback(
    (t: number) => {
      const timeline = replayed ?? controller.getTimeline();
      return timeline ? sampleTimeline(timeline, t) : null;
    },
    [controller, replayed],
  );

  return {
    controller,
    frame,
    props,
    setProps,
    mode,
    setMode,
    resetKey,
    steps,
    playhead,
    warnings,
    replayed,
    inspectAt,
    seek,
    pause,
    reset,
    continueFromHere,
    sample,
  };
}

export type Session = ReturnType<typeof useSession>;
