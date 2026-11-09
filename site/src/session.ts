import { createController } from '../../packages/studio/runtime/controller';
import type { MotionSpec, Rects } from '../../packages/studio/runtime/spec';
import {
  isAnimating,
  lastMark,
  pendingQueue,
  replayTake,
  type ReplayStep,
  type TakeEvent,
  type Timeline,
} from '../../packages/studio/runtime/timeline';
import type { Showcase } from './showcase';
import { edgeAt, type Levels } from './trace';

export type Geometry = Record<string, Rects>;
export type Command = Extract<TakeEvent, { type: 'command' }>;

export interface Take {
  startMs: number;
  initialState: string;
  events: Command[];
  /** The example on the page, as opposed to something this visitor did. */
  scripted: boolean;
}

/**
 * live: time runs and the panel takes input, recording a take.
 * paused: the panel is held at one moment of the take.
 * playing: the take runs back, at the current speed.
 * Input never waits for a mode. Pressing anything while paused or playing continues from that
 * moment, so a button in the panel always does what it says.
 */
export type Phase = 'live' | 'paused' | 'playing';

export interface Snapshot {
  spec: MotionSpec;
  take: Take;
  timeline: Timeline;
  /** The same take without the interruption, for the dotted line. */
  ghost: Timeline | null;
  /** The same take under a second spec, when two are being raced. */
  rival: Timeline | null;
  rivalSpec: MotionSpec | null;
  levels: Levels;
  steps: ReplayStep[];
  domain: { start: number; end: number };
  /** When the take has finished, with a little air. */
  takeEnd: number;
  phase: Phase;
  moving: boolean;
  state: string;
  slow: boolean;
  /** Index into take.events of the interruption being shown. */
  marker: number | null;
}

/** Time before the first command, on the curve. */
export const LEAD_MS = 60;
const TAIL_MS = 60;
/** The curve keeps this width unless a take needs more, so its axis does not jump. */
const WINDOW_MS = 700;
const WINDOW_STEP_MS = 100;
export const SLOW_RATE = 0.25;
const MARKER_GAP_MS = 10;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A clock whose rate can change mid flight, so slow motion also slows the live component. */
function createRateClock() {
  let rate = 1;
  let anchorReal = performance.now();
  let anchorTime = anchorReal;
  const now = () => anchorTime + (performance.now() - anchorReal) * rate;
  return {
    now,
    requestFrame(callback: () => void) {
      const id = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(id);
    },
    setRate(next: number) {
      anchorTime = now();
      anchorReal = performance.now();
      rate = next;
    },
  };
}

export type Session = ReturnType<typeof createSession>;

export interface SessionStart {
  spec: MotionSpec;
  /** When the interruption lands in the example take, after the first command. */
  delayMs: number;
}

export function createSession(showcase: Showcase, start: SessionStart) {
  const clock = createRateClock();
  const listeners = new Set<() => void>();
  const frameListeners = new Set<(t: number) => void>();

  let spec = start.spec;
  let rivalSpec: MotionSpec | null = null;
  let levels: Levels = { low: 0, high: 0, clip: Number.POSITIVE_INFINITY };
  let geometry: Geometry | null = null;
  let snapshot: Snapshot | null = null;
  let take: Take = {
    startMs: 0,
    initialState: showcase.spec.initialState,
    scripted: true,
    events: [
      { atMs: LEAD_MS, type: 'command', command: showcase.go },
      { atMs: LEAD_MS + start.delayMs, type: 'command', command: showcase.back },
    ],
  };
  let phase: Phase = 'paused';
  let moving = false;
  let slow = false;
  let time = 0;
  let playAnchor = 0;
  let frame = 0;
  let dragging: number | null = null;
  let lockedDomain: Snapshot['domain'] | null = null;
  let cancelPending: (() => void) | null = null;

  const controller = createController(start.spec, {
    clock,
    history: true,
    onEvent(event) {
      if (event.type !== 'command') return;
      take = { ...take, events: [...take.events, event].sort((a, b) => a.atMs - b.atMs) };
      phase = 'live';
      moving = true;
      derive();
      ensureLoop();
    },
  });

  function replay(events: Command[], initialState: string, startMs: number, endMs?: number, using: MotionSpec = spec) {
    return replayTake(
      { ...using, initialState },
      startMs,
      geometry![initialState]!,
      events,
      (state) => geometry![state]!,
      endMs === undefined ? {} : { endMs },
    );
  }

  /** Everything the page shows follows from the take and the spec, and is rebuilt here. */
  function derive() {
    if (!geometry) return;
    const { timeline, steps } = replay(take.events, take.initialState, take.startMs);
    const interruptions = take.events.length - 1;
    const marker = dragging ?? (interruptions > 0 ? interruptions : null);
    const ghost = marker === null ? null : replay(take.events.filter((_, i) => i !== marker), take.initialState, take.startMs).timeline;
    const first = take.events[0]?.atMs ?? take.startMs;
    const last = take.events[take.events.length - 1]?.atMs ?? first;
    const rival = rivalSpec ? replay(take.events, take.initialState, take.startMs, undefined, rivalSpec).timeline : null;
    const settled = Math.max(lastMark(timeline).settleMs, ghost ? lastMark(ghost).settleMs : 0, rival ? lastMark(rival).settleMs : 0, last);
    const start = first - LEAD_MS;
    const needed = Math.ceil((settled + TAIL_MS - start) / WINDOW_STEP_MS) * WINDOW_STEP_MS;
    const domain = lockedDomain ?? { start, end: start + Math.max(WINDOW_MS, needed) };
    snapshot = {
      spec,
      take,
      timeline,
      ghost,
      rival,
      rivalSpec,
      levels,
      steps,
      domain,
      takeEnd: lastMark(timeline).settleMs + TAIL_MS,
      phase,
      moving,
      state: controller.getState(),
      slow,
      marker,
    };
    for (const listener of listeners) listener();
  }

  function publish() {
    if (!snapshot) return;
    snapshot = { ...snapshot, phase, moving, slow, state: controller.getState() };
    for (const listener of listeners) listener();
  }

  controller.subscribe(() => {
    if (snapshot && snapshot.state !== controller.getState()) publish();
  });

  function emit() {
    for (const listener of frameListeners) listener(time);
  }

  function ensureLoop() {
    if (!frame) frame = requestAnimationFrame(step);
  }

  function step() {
    frame = 0;
    if (phase === 'playing') {
      const end = snapshot!.takeEnd;
      time = Math.min(end, clock.now() - playAnchor);
      controller.seek(time);
      emit();
      if (time >= end) {
        phase = 'paused';
        publish();
      } else {
        ensureLoop();
      }
      return;
    }
    if (phase !== 'live') return;
    time = controller.now();
    emit();
    const live = controller.getTimeline();
    if (live && (isAnimating(live, time) || pendingQueue(live))) {
      ensureLoop();
    } else if (moving) {
      moving = false;
      publish();
    }
  }

  /** Holds the panel at t, showing the take as it now stands. */
  function hold(t: number) {
    controller.setSpec({ ...spec, initialState: take.initialState });
    controller.load(snapshot!.timeline, t);
    time = t;
    moving = false;
    phase = 'paused';
  }

  /** Starts a new take from whatever the panel is doing now. */
  function freshTake(t: number) {
    const initialState = controller.getState();
    take = { startMs: t - 2 * LEAD_MS, initialState, events: [], scripted: false };
    const { timeline } = replay([], initialState, take.startMs);
    controller.setSpec({ ...spec, initialState });
    controller.load(timeline, t);
    controller.resume();
  }

  /** Keeps the take up to t and lets time run on from exactly there, speed intact. */
  function continueFrom(t: number) {
    take = { ...take, scripted: false, events: take.events.filter((event) => event.atMs <= t) };
    const { timeline } = replay(take.events, take.initialState, take.startMs, t);
    controller.setSpec({ ...spec, initialState: take.initialState });
    controller.load(timeline, t);
    controller.resume();
  }

  function dismissPending() {
    cancelPending?.();
    cancelPending = null;
  }

  /** The one path for every command, from the panel's own buttons and from the toolbar. */
  function send(command: string) {
    dismissPending();
    if (controller.isFrozen()) {
      const timeline = snapshot!.timeline;
      if (time >= lastMark(timeline).settleMs && !pendingQueue(timeline)) freshTake(time);
      else continueFrom(time);
    } else if (!moving) {
      freshTake(controller.now());
    }
    phase = 'live';
    controller.send(command);
  }

  function pause() {
    if (phase === 'playing') {
      phase = 'paused';
      publish();
    } else if (phase === 'live' && moving) {
      hold(controller.now());
      publish();
      emit();
    }
  }

  function seek(t: number) {
    dismissPending();
    if (!snapshot) return;
    const next = Math.max(snapshot.domain.start, Math.min(snapshot.domain.end, t));
    if (phase === 'paused' && controller.isFrozen()) {
      controller.seek(next);
      time = next;
    } else {
      hold(next);
      publish();
    }
    emit();
  }

  function startPlaying(from: number) {
    hold(from);
    playAnchor = clock.now() - from;
    phase = 'playing';
    publish();
    emit();
    ensureLoop();
  }

  function atEnd() {
    if (phase === 'live') return !moving;
    return time >= snapshot!.takeEnd - 1;
  }

  /** Runs once the element is on screen and the page has stopped moving. */
  function whenInView(element: Element, run: () => void) {
    dismissPending();
    let frameId = 0;
    let stillFrames = 0;
    let lastY = scrollY;
    const waitForRest = () => {
      stillFrames = scrollY === lastY ? stillFrames + 1 : 0;
      lastY = scrollY;
      if (stillFrames >= 3) {
        cancelPending = null;
        run();
      } else {
        frameId = requestAnimationFrame(waitForRest);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        frameId = requestAnimationFrame(waitForRest);
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    cancelPending = () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }

  return {
    controller,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => snapshot,
    onFrame(listener: (t: number) => void) {
      frameListeners.add(listener);
      return () => void frameListeners.delete(listener);
    },
    time: () => time,
    send,
    seek,
    pause,

    setGeometry(next: Geometry, nextLevels: Levels) {
      const first = geometry === null;
      geometry = next;
      levels = nextLevels;
      derive();
      if (first) {
        hold(snapshot!.takeEnd);
        publish();
      } else if (controller.isFrozen()) {
        controller.load(snapshot!.timeline, Math.min(time, snapshot!.domain.end));
      }
      // This runs inside a React commit, and a frame listener may need to flush its own.
      queueMicrotask(emit);
    },

    /** Replay and Pause share a button. Nothing moves until the panel is in view. */
    toggle(view: Element) {
      if (!snapshot) return;
      if (phase === 'playing') {
        pause();
        return;
      }
      const from = atEnd() ? snapshot.domain.start : time;
      if (reducedMotion()) {
        dismissPending();
        hold(snapshot.takeEnd);
        publish();
        emit();
        return;
      }
      const box = view.getBoundingClientRect();
      const showing = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
      if (showing >= Math.min(box.height, innerHeight) * 0.6) {
        dismissPending();
        startPlaying(from);
        return;
      }
      view.scrollIntoView({ block: 'center', behavior: 'smooth' });
      whenInView(view, () => startPlaying(snapshot!.domain.start));
    },

    /** Runs the whole take again, for the export preview to follow. */
    replayFromStart(view: Element) {
      if (!snapshot || reducedMotion()) return;
      whenInView(view, () => startPlaying(snapshot!.domain.start));
    },

    /** Plays the example once, the first time it is seen, unless the visitor got there first. */
    introduce(view: Element, delayMs: number) {
      if (reducedMotion()) return;
      whenInView(view, () => {
        const id = setTimeout(() => {
          cancelPending = null;
          startPlaying(snapshot!.domain.start);
        }, delayMs);
        cancelPending = () => clearTimeout(id);
      });
    },
    dismissIntro: dismissPending,

    setSpec(next: MotionSpec, replayAfter: boolean, view: Element | null) {
      dismissPending();
      const wasAtEnd = snapshot !== null && atEnd();
      spec = next;
      derive();
      if (!snapshot) return;
      const t = wasAtEnd ? snapshot.takeEnd : Math.min(time, snapshot.takeEnd);
      hold(t);
      if (replayAfter && view && !reducedMotion()) {
        startPlaying(snapshot.domain.start);
      } else {
        publish();
        emit();
      }
    },

    setSlow(next: boolean) {
      slow = next;
      clock.setRate(next ? SLOW_RATE : 1);
      publish();
    },

    beginDrag(index: number) {
      dismissPending();
      dragging = index;
      lockedDomain = snapshot!.domain;
      derive();
    },
    endDrag() {
      dragging = null;
      lockedDomain = null;
      derive();
    },

    /**
     * Holds the time axis still while the spring is dragged on the plot. A softer spring settles
     * later, and an axis that grew under the pointer would read as a still softer spring.
     */
    holdAxis(held: boolean) {
      lockedDomain = held ? snapshot!.domain : null;
      if (!held) derive();
    },

    /** Moves one interruption along the take. The panel follows, held at that moment. */
    moveMarker(index: number, atMs: number) {
      dismissPending();
      const events = take.events;
      const before = events[index - 1]!.atMs + MARKER_GAP_MS;
      const after = (events[index + 1]?.atMs ?? snapshot!.domain.end - TAIL_MS) - MARKER_GAP_MS;
      const next = Math.round(Math.max(before, Math.min(after, atMs)));
      take = { ...take, events: events.map((event, i) => (i === index ? { ...event, atMs: next } : event)) };
      phase = 'paused';
      moving = false;
      derive();
      hold(next);
      publish();
      emit();
    },

    /** Races the take under a second spec, or stops when given null. Nothing else changes. */
    setRival(next: MotionSpec | null) {
      if (next === rivalSpec) return;
      rivalSpec = next;
      derive();
      queueMicrotask(emit);
    },

    /** Moves the example's interruption without touching the panel, for restoring a link. */
    exampleDelay: () => (take.events.length > 1 ? take.events[1]!.atMs - take.events[0]!.atMs : null),

    /** The followed edge at a moment of the take shown. */
    reading(t: number, of: 'take' | 'rival' = 'take'): { position: number; velocity: number } {
      const timeline = of === 'rival' ? snapshot!.rival : snapshot!.timeline;
      return edgeAt(timeline ?? snapshot!.timeline, showcase, t, levels);
    },
  };
}
