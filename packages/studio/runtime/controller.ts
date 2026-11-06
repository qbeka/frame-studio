import { drawSample, findBadNesting, focusTarget, measureTargets } from './dom';
import type { MotionSpec, Rects } from './spec';
import {
  applyDecision,
  applyRemeasure,
  createTimeline,
  decideCommand,
  isAnimating,
  lastMark,
  pendingQueue,
  pruneTimeline,
  sampleTimeline,
  type Decision,
  type TakeEvent,
  type Timeline,
} from './timeline';

/** Time source. Injectable so tests and scrubbing can step time by hand. */
export interface FrameClock {
  now(): number;
  /** Runs the callback once, at the next frame. Returns a cancel function. */
  requestFrame(callback: () => void): () => void;
}

export function browserClock(): FrameClock {
  return {
    now: () => performance.now(),
    requestFrame(callback) {
      const id = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(id);
    },
  };
}

export type FrameWarning =
  | { code: 'missing-target'; targets: string[] }
  | { code: 'unknown-target'; targets: string[] }
  | { code: 'nested-target'; targets: string[] }
  | { code: 'rejected-command'; command: string; state: string };

export interface FrameOptions {
  clock?: FrameClock;
  /** Forces reduced motion on or off. By default it follows the user's system setting. */
  reducedMotion?: boolean;
  onWarning?: (warning: FrameWarning) => void;
  /** Called for each command and layout change, in order. The studio records takes from this. */
  onEvent?: (event: TakeEvent, startMs: number) => void;
  /** Keep the past so it can be scrubbed. Consumers leave this off. */
  history?: boolean;
}

interface Pending {
  atMs: number;
  decision: Decision;
  reduced: boolean;
  /** Was focus inside something this transition may hide? */
  active: Element | null;
}

export type FrameController = ReturnType<typeof createController>;

export function createController(initialSpec: MotionSpec, options: FrameOptions = {}) {
  let spec = initialSpec;
  const clock = options.clock ?? browserClock();
  const elements = new Map<string, HTMLElement>();
  const listeners = new Set<() => void>();
  const pending: Pending[] = [];
  let root: HTMLElement | null = null;
  let timeline: Timeline | null = null;
  let state = spec.initialState;
  let version = 0;
  let cancelFrame: (() => void) | null = null;
  let observer: ResizeObserver | null = null;
  let started = false;
  /** Scrubbing holds time still here. Null means live. */
  let frozenAt: number | null = null;
  /** Live time is the clock plus this, so a take can resume from where it was paused. */
  let offsetMs = 0;
  let startMs = 0;

  const now = () => frozenAt ?? clock.now() + offsetMs;

  function notify() {
    version += 1;
    for (const listener of listeners) listener();
  }

  function inFlowNow(id: string) {
    return spec.states[state]!.targets[id]?.present === true;
  }

  function measure(): Rects {
    return measureTargets(root!, elements, inFlowNow);
  }

  function reducedNow() {
    if (options.reducedMotion !== undefined) return options.reducedMotion;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function render() {
    if (!timeline) return;
    drawSample(spec, elements, sampleTimeline(timeline, now()));
  }

  function stopLoop() {
    cancelFrame?.();
    cancelFrame = null;
  }

  function ensureLoop() {
    if (cancelFrame || frozenAt !== null || !timeline) return;
    if (!isAnimating(timeline, now()) && !pendingQueue(timeline)) return;
    cancelFrame = clock.requestFrame(tick);
  }

  function tick() {
    cancelFrame = null;
    if (!timeline) return;
    const t = now();
    const due = pendingQueue(timeline);
    // The queued command runs at its settle time, however late this frame is.
    if (due && due.atMs <= t) {
      lastMark(timeline).queued = null;
      dispatch(due.command, due.atMs);
      return;
    }
    render();
    if (!options.history) pruneTimeline(timeline, t);
    ensureLoop();
  }

  function dispatch(command: string, atMs: number) {
    if (!timeline) return;
    const decision = decideCommand(timeline, atMs, command);
    if (decision.kind === 'reject') {
      options.onWarning?.({ code: 'rejected-command', command, state });
      return;
    }
    if (decision.kind === 'ignore') return;
    const reduced = reducedNow();
    if (decision.kind === 'queue') {
      applyDecision(timeline, atMs, decision, {}, { reduced });
      options.onEvent?.({ atMs, type: 'command', command, reduced }, startMs);
      ensureLoop();
      return;
    }
    // At rest the last measured boxes may be stale, for example after a resize, so take the
    // true starting layout while it is still on screen. Mid flight the channels already know.
    if (root && !isAnimating(timeline, atMs)) {
      const rects = measure();
      const before = timeline.marks.length;
      applyRemeasure(timeline, atMs, rects, spec.resize);
      // Recorded, or a replay would start from the layout before this change.
      if (timeline.marks.length !== before) options.onEvent?.({ atMs, type: 'measure', rects }, startMs);
      render();
    }
    pending.push({ atMs, decision, reduced, active: document.activeElement });
    state = decision.transition.to;
    notify();
  }

  function restoreFocus(item: Pending) {
    const active = item.active;
    if (!active || active === document.body) return;
    const stillAvailable = active.isConnected && !active.closest('[inert],[hidden]') && document.activeElement === active;
    if (stillAvailable) return;
    const id = spec.states[state]!.focusTarget;
    const element = id ? elements.get(id) : undefined;
    if (element) focusTarget(element);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
    getState: () => state,
    getTimeline: () => timeline,
    getStartMs: () => startMs,
    now,

    setRoot(element: HTMLElement | null) {
      root = element;
    },
    setTarget(id: string, element: HTMLElement | null) {
      if (element) elements.set(id, element);
      else elements.delete(id);
    },

    /** Called after every React commit, in a layout effect, so it runs before paint. */
    commit() {
      if (!root) return;
      if (!timeline) {
        startMs = now();
        timeline = createTimeline(spec, startMs, measure());
        const unknown = [...elements.keys()].filter((id) => !spec.targets[id]);
        if (unknown.length > 0) options.onWarning?.({ code: 'unknown-target', targets: unknown });
        const nested = findBadNesting(spec, elements);
        if (nested.length > 0) options.onWarning?.({ code: 'nested-target', targets: nested });
        render();
        return;
      }
      if (frozenAt !== null) {
        render();
        return;
      }
      if (pending.length > 0) {
        const rects = measure();
        const items = pending.splice(0);
        for (const item of items) {
          const missing = applyDecision(timeline, item.atMs, item.decision, rects, { reduced: item.reduced });
          if (missing.length > 0) options.onWarning?.({ code: 'missing-target', targets: missing });
          if (item.decision.kind === 'start') {
            options.onEvent?.(
              { atMs: item.atMs, type: 'command', command: item.decision.transition.command, reduced: item.reduced, rects },
              startMs,
            );
          }
        }
        render();
        // After drawing, because drawing is what marks a leaving target inert.
        for (const item of items) restoreFocus(item);
        ensureLoop();
        return;
      }
      if (isAnimating(timeline, now())) this.remeasure();
    },

    /** Layout changed with no command. Cheap at rest, where it does nothing. */
    remeasure() {
      if (!root || !timeline || frozenAt !== null) return;
      const t = now();
      if (!isAnimating(timeline, t)) return;
      const rects = measure();
      const before = timeline.marks.length;
      applyRemeasure(timeline, t, rects, spec.resize);
      if (timeline.marks.length !== before) options.onEvent?.({ atMs: t, type: 'measure', rects }, startMs);
      render();
      ensureLoop();
    },

    send(command: string) {
      if (frozenAt !== null) return;
      dispatch(command, now());
    },

    start() {
      if (started || !root) return;
      started = true;
      const remeasure = () => this.remeasure();
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null;
      observer?.observe(root);
      // Scrollers inside the root move targets relative to it. Page scrolling does not.
      root.addEventListener('scroll', remeasure, { capture: true, passive: true });
      this.stop = () => {
        started = false;
        stopLoop();
        observer?.disconnect();
        root?.removeEventListener('scroll', remeasure, { capture: true });
      };
    },
    stop() {},

    /** Studio only: replaces the spec. The caller rebuilds the timeline with `load`. */
    setSpec(next: MotionSpec) {
      spec = next;
    },

    /** Studio only: shows `next` frozen at time t, with semantic state taken from that moment. */
    load(next: Timeline, t: number) {
      stopLoop();
      pending.length = 0;
      timeline = next;
      frozenAt = t;
      const sampled = sampleTimeline(next, t).state;
      if (sampled !== state) {
        state = sampled;
        notify();
      }
      render();
    },
    seek(t: number) {
      if (!timeline) return;
      frozenAt = t;
      const sampled = sampleTimeline(timeline, t).state;
      if (sampled !== state) {
        state = sampled;
        notify();
      }
      render();
    },
    /** Studio only: time starts running again from the frozen moment, velocity intact. */
    resume() {
      if (frozenAt === null) return;
      offsetMs = frozenAt - clock.now();
      frozenAt = null;
      ensureLoop();
      render();
    },
    /** Studio only: drops the timeline and rebuilds it from the current native layout. */
    reset(nextState: string) {
      stopLoop();
      pending.length = 0;
      frozenAt = null;
      offsetMs = 0;
      timeline = null;
      for (const element of elements.values()) {
        element.removeAttribute('data-frame-exiting');
        element.inert = false;
      }
      state = nextState;
      notify();
    },
    isFrozen: () => frozenAt !== null,
  };
}
