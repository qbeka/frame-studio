import { drawSample, findBadNesting, focusTarget, measureTargets } from './dom';
import type { MotionSpec, Rects } from './spec';
import type { Hand } from './channel';
import {
  applyDecision,
  applyRelease,
  applyRemeasure,
  clearQueue,
  createTimeline,
  decideCommand,
  isAnimating,
  moveHand,
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
  /** A queued command's run. The take already has it, so it is not recorded twice. */
  fromQueue: boolean;
  /** Already applied, against the last known layout. See `applyUncommitted`. */
  applied: boolean;
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
  /** React has mounted us. The listeners attach once there is also a root. */
  let wanted = false;
  /** Scrubbing holds time still here. Null means live. */
  let frozenAt: number | null = null;
  /** Live time is the clock plus this, so a take can resume from where it was paused. */
  let offsetMs = 0;
  let startMs = 0;
  /** The element under the current click. See `start`. */
  let pressed: Element | null = null;
  let detach: (() => void) | null = null;
  /** Commands sent before the first commit, such as from a child's layout effect. */
  const early: string[] = [];
  /** The hand on the component, from `grab` until it lets go. */
  let held: Hand | null = null;

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
    if (root) drawSample(spec, root, elements, sampleTimeline(timeline, now()));
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

  /** Runs a queued command that has come due. It keeps its exact settle time. */
  function drainDue(t: number) {
    if (!timeline) return;
    const due = pendingQueue(timeline);
    if (!due || due.atMs > t) return;
    clearQueue(timeline);
    dispatch(due.command, due.atMs, true);
  }

  function tick() {
    cancelFrame = null;
    if (!timeline) return;
    const t = now();
    drainDue(t);
    // With a transition pending, the commit it triggered does the drawing.
    if (pending.length > 0) return;
    render();
    if (!options.history) pruneTimeline(timeline, t);
    ensureLoop();
  }

  function record(item: Pending, rects: Rects) {
    if (item.fromQueue || item.decision.kind !== 'start') return;
    const { command } = item.decision.transition;
    const { hand } = item.decision;
    const event = { atMs: item.atMs, command, reduced: item.reduced, rects };
    options.onEvent?.(hand ? { ...event, type: 'grab', progress: hand.progress[0]! } : { ...event, type: 'command' }, startMs);
  }

  /**
   * A second command in one event handler must be judged from the state the first one reached,
   * but React has not committed that state, so its layout does not exist yet. The first command
   * is applied against the last known boxes. Nothing has been painted, and the commit corrects
   * the endpoints before anyone can see them.
   */
  function applyUncommitted() {
    if (!timeline) return;
    for (const item of pending) {
      if (item.applied || item.decision.kind !== 'start') continue;
      const inFlow = spec.states[item.decision.transition.to]!.targets;
      const rects: Rects = {};
      for (const [id, rect] of Object.entries(timeline.lastRects)) if (inFlow[id]?.present) rects[id] = rect;
      applyDecision(timeline, item.atMs, item.decision, rects, { reduced: item.reduced });
      item.applied = true;
      record(item, rects);
    }
  }

  function dispatch(command: string, atMs: number, fromQueue = false, hand?: Hand) {
    if (!timeline) return;
    applyUncommitted();
    const decision = decideCommand(timeline, atMs, command, hand);
    const reduced = reducedNow();
    // Refused and ignored commands stay in the take, because an edit could change their fate.
    if (decision.kind === 'reject' || decision.kind === 'ignore') {
      if (!fromQueue) options.onEvent?.({ atMs, type: 'command', command, reduced }, startMs);
      if (decision.kind === 'reject') options.onWarning?.({ code: 'rejected-command', command, state });
      return;
    }
    if (decision.kind === 'queue') {
      applyDecision(timeline, atMs, decision, {}, { reduced });
      options.onEvent?.({ atMs, type: 'command', command, reduced }, startMs);
      ensureLoop();
      return;
    }
    // At rest the last measured boxes may be stale, for example after a resize, so take the
    // true starting layout while it is still on screen. Mid flight the channels already know.
    if (root && pending.length === 0 && !isAnimating(timeline, atMs)) {
      const rects = measure();
      const before = timeline.marks.length;
      applyRemeasure(timeline, atMs, rects, spec.resize);
      // Recorded, or a replay would start from the layout before this change.
      if (timeline.marks.length !== before) options.onEvent?.({ atMs, type: 'measure', rects }, startMs);
      render();
    }
    const focused = document.activeElement;
    const active = focused && focused !== document.body ? focused : pressed;
    pending.push({ atMs, decision, reduced, active, fromQueue, applied: false });
    // Whatever starts either belongs to the hand that grabbed it or has taken over from one.
    held = hand ?? null;
    state = decision.transition.to;
    notify();
  }

  function remeasure() {
    if (!root || !timeline || frozenAt !== null) return;
    const t = now();
    if (!isAnimating(timeline, t)) return;
    const rects = measure();
    const before = timeline.marks.length;
    applyRemeasure(timeline, t, rects, spec.resize);
    if (timeline.marks.length !== before) options.onEvent?.({ atMs: t, type: 'measure', rects }, startMs);
    render();
    ensureLoop();
  }

  function attach() {
    if (!wanted || !root || detach) return;
    const target = root;
    observer = typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null;
    observer?.observe(target);
    // Safari does not focus a button when it is clicked, so focus can sit on the body while the
    // control the person just used disappears. Remember what was pressed, for the length of this
    // click only, so that focus moves on in every browser.
    const onClick = (event: Event) => {
      pressed = event.target as Element;
      setTimeout(() => (pressed = null));
    };
    target.addEventListener('click', onClick, { capture: true });
    // Scrollers inside the root move targets relative to it. Page scrolling does not.
    target.addEventListener('scroll', remeasure, { capture: true, passive: true });
    detach = () => {
      observer?.disconnect();
      target.removeEventListener('click', onClick, { capture: true });
      target.removeEventListener('scroll', remeasure, { capture: true });
      detach = null;
    };
  }

  function restoreFocus(item: Pending) {
    const active = item.active;
    if (!active) return;
    if (active.isConnected && !active.closest('[inert],[hidden]')) return;
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
      if (element === root) return;
      detach?.();
      root = element;
      attach();
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
        for (const command of early.splice(0)) dispatch(command, now());
        return;
      }
      if (frozenAt !== null) {
        render();
        return;
      }
      if (pending.length > 0) {
        const rects = measure();
        const items = pending.splice(0);
        // If the last command was applied early, its true layout is only known now.
        const last = items[items.length - 1]!;
        const lastWasEarly = last.applied;
        for (const item of items) {
          if (item.applied) continue;
          const missing = applyDecision(timeline, item.atMs, item.decision, rects, { reduced: item.reduced });
          item.applied = true;
          if (missing.length > 0) options.onWarning?.({ code: 'missing-target', targets: missing });
          record(item, rects);
        }
        if (lastWasEarly) {
          // At the current time, not the command's: reading an older mark would lose a queue.
          const t = now();
          applyRemeasure(timeline, t, rects, 'retarget');
          options.onEvent?.({ atMs: t, type: 'measure', rects }, startMs);
        }
        render();
        // After drawing, because drawing is what marks a leaving target inert.
        for (const item of items) restoreFocus(item);
        if (!options.history) pruneTimeline(timeline, now());
        ensureLoop();
        return;
      }
      remeasure();
    },

    /** Layout changed with no command. Cheap at rest, where it does nothing. */
    remeasure,

    send(command: string) {
      if (frozenAt !== null) return;
      if (!timeline) {
        early.push(command);
        return;
      }
      const t = now();
      // A command can land after a queued one came due but before the next frame ran it.
      drainDue(t);
      dispatch(command, t);
    },

    /**
     * A hand takes hold of the transition `command` starts. The state changes at once, as it does
     * for `send`, and from then on the motion follows `drag` instead of its curves. `progress` is
     * 0 at the state being left and 1 at the state being entered, and may pass either end. A hand
     * outranks the interruption rules, so this also catches a transition that is running.
     * Returns false when there is nothing to take hold of.
     */
    grab(command: string, progress: number) {
      if (frozenAt !== null || !timeline || held) return false;
      const t = now();
      drainDue(t);
      const hand: Hand = { times: [t], progress: [progress] };
      dispatch(command, t, false, hand);
      return held === hand;
    },
    /** Moves the hand. Does nothing unless one is holding on. */
    drag(progress: number) {
      if (!held || !timeline) return;
      const t = now();
      moveHand(held, t, progress);
      options.onEvent?.({ atMs: t, type: 'drag', progress }, startMs);
      if (pending.length === 0) render();
    },
    /**
     * The hand lets go and the transition carries on into the state it entered, on its own curves,
     * from the hand's position and speed. To let go the other way, `send` the command that goes
     * back: it leaves from the hand's position and speed in the same way.
     */
    release() {
      if (!held || !timeline) return;
      const t = now();
      held = null;
      // A grab let go of before its commit is applied against the last known layout first.
      applyUncommitted();
      const reduced = reducedNow();
      applyRelease(timeline, t, { reduced });
      options.onEvent?.({ atMs: t, type: 'release', reduced }, startMs);
      if (pending.length === 0) render();
      ensureLoop();
    },
    isHeld: () => held !== null,

    start() {
      wanted = true;
      attach();
      ensureLoop();
    },
    stop() {
      wanted = false;
      stopLoop();
      detach?.();
    },

    /** Studio only: replaces the spec. The caller rebuilds the timeline with `load` or `reset`. */
    setSpec(next: MotionSpec) {
      spec = next;
    },

    /** Studio only: shows `next` frozen at time t, with semantic state taken from that moment. */
    load(next: Timeline, t: number) {
      stopLoop();
      pending.length = 0;
      held = null;
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
      early.length = 0;
      held = null;
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
