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
import type { TakeContext } from './library';
import type { Showcase } from './showcase';
import { edgeAt, type Levels } from './trace';
import type { TakeSource } from './urlState';

export type Geometry = Record<string, Rects>;
/** What a take on this page is made of: presses, and a hand taking hold, moving and letting go. */
export type TakeItem = Extract<TakeEvent, { type: 'command' | 'grab' | 'drag' | 'release' }>;
export type Command = Extract<TakeEvent, { type: 'command' }>;

export interface Take {
  startMs: number;
  initialState: string;
  events: TakeItem[];
  /** An example on the page, as opposed to something this visitor did. */
  scripted: boolean;
  /** Which example, when it is one. */
  name: string | null;
}

/** One stretch of a take where a hand held the component. */
export interface HandSpan {
  fromMs: number;
  /** Null while the hand is still holding on. */
  toMs: number | null;
  /** The speed of the followed edge at the moment the hand let go, in pixels per second. */
  speed: number;
  /** Where the samples fall, for the dots under the hand. */
  samples: number[];
}

/**
 * live: time runs and the panel takes input, recording a take.
 * paused: the panel is held at one moment of the take.
 * playing: the take runs back, at the current speed.
 * Input never waits for a mode. Pressing or grabbing while paused or playing continues from that
 * moment, so the component always does what the hand on it says.
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
  geometry: Geometry;
  steps: ReplayStep[];
  domain: { start: number; end: number };
  /** When the take has finished, with a little air. */
  takeEnd: number;
  phase: Phase;
  moving: boolean;
  /** A hand is on the component right now. */
  held: boolean;
  hands: HandSpan[];
  state: string;
  slow: boolean;
  /** Index into take.events of the interruption being shown. Only takes made of presses have one. */
  marker: number | null;
  /** Moves whenever the past of the take changes, as opposed to the take growing at its end. */
  epoch: number;
}

/** Time before the first command, on the curve. */
export const LEAD_MS = 60;
export const TAIL_MS = 60;
/** The curve keeps this width unless a take needs more, so its axis does not jump. */
const WINDOW_MS = 700;
const WINDOW_STEP_MS = 100;
/** While a hand holds on nobody knows how long the take will be, so the axis grows in strides. */
const HELD_STEP_MS = 400;
export const SLOW_RATE = 0.25;
const MARKER_GAP_MS = 10;
/** Recorded times sit on a quarter millisecond grid and progress on 1/4096, which a link can hold exactly. */
export const TIME_GRID = 4;
export const PROGRESS_GRID = 4096;
/** How far ahead of the hand a let-go is judged: a flick past the middle carries on. */
const THROW_LOOKAHEAD_S = 0.14;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const onGrid = (progress: number) => Math.round(progress * PROGRESS_GRID) / PROGRESS_GRID;

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
  /** The take the page opens on. */
  take: TakeSource;
}

/** A take as a strip can show it: worked out under the current motion, without touching the stage. */
export interface Preview {
  timeline: Timeline;
  startMs: number;
  endMs: number;
}

export function createSession(showcase: Showcase, start: SessionStart) {
  const clock = createRateClock();
  const listeners = new Set<() => void>();
  const frameListeners = new Set<(t: number) => void>();

  let spec = start.spec;
  let rivalSpec: MotionSpec | null = null;
  let levels: Levels = { low: 0, high: 0, clip: Number.POSITIVE_INFINITY };
  let geometry: Geometry | null = null;
  let geometryKey = '';
  let snapshot: Snapshot | null = null;
  let take: Take = { startMs: 0, initialState: start.take.initialState, events: [], scripted: start.take.scripted, name: start.take.name };
  let phase: Phase = 'paused';
  let moving = false;
  let slow = false;
  let time = 0;
  let playAnchor = 0;
  let frame = 0;
  let dragging: number | null = null;
  let lockedDomain: Snapshot['domain'] | null = null;
  let cancelPending: (() => void) | null = null;
  let epoch = 0;
  /** Events have arrived since the page last worked the take out. */
  let stale = false;
  /** The command the hand took hold of, while it holds on. */
  let holding: string | null = null;

  const controller = createController(start.spec, {
    clock,
    history: true,
    onEvent(event) {
      if (event.type === 'measure' || event.type === 'props') return;
      // The page and a link agree on every moment, because both only ever see the grid.
      const atMs = take.startMs + Math.round((event.atMs - take.startMs) * TIME_GRID) / TIME_GRID;
      const kept = { ...event, atMs } as TakeItem & { rects?: Rects };
      // The page measures every state itself, so a take does not carry layout around.
      delete kept.rects;
      take = { ...take, events: [...take.events, kept].sort((a, b) => a.atMs - b.atMs) };
      phase = 'live';
      moving = true;
      // A hand sends many of these between two frames, so the next frame works them all out at once.
      // Taking hold waits for that frame too: the press that takes hold has enough to do already.
      if (event.type === 'drag' || event.type === 'grab') stale = true;
      else derive();
      ensureLoop();
    },
  });

  function replay(events: TakeItem[], initialState: string, startMs: number, endMs?: number, using: MotionSpec = spec) {
    return replayTake(
      { ...using, initialState },
      startMs,
      geometry![initialState]!,
      events,
      (state) => geometry![state]!,
      endMs === undefined ? {} : { endMs },
    );
  }

  const span = () => levels.high - levels.low;
  /** How far through `command` the followed edge is when it sits at `edge`. */
  const progressOf = (command: string, edge: number) => {
    const forward = span() === 0 ? 0 : (edge - levels.low) / span();
    return command === showcase.go ? forward : 1 - forward;
  };

  /** Lays a take out from time zero, with its first event one lead in. */
  function placeTake(source: TakeSource): Take {
    const lay = (events: TakeItem[]) => events.map((event) => ({ ...event, atMs: LEAD_MS + event.atMs - (events[0]?.atMs ?? 0) }));
    const context: TakeContext = {
      progressAt(events, atMs, command) {
        const { timeline } = replay(lay(events), source.initialState, 0);
        return onGrid(progressOf(command, edgeAt(timeline, showcase, LEAD_MS + atMs - (events[0]?.atMs ?? 0), levels).position));
      },
    };
    return { startMs: 0, initialState: source.initialState, scripted: source.scripted, name: source.name, events: lay(source.build(context)) };
  }

  /** When a timeline comes to rest. A hand that is still holding on has not let it. */
  const restOf = (timeline: Timeline, fallback: number) => {
    const settle = lastMark(timeline).settleMs;
    return Number.isFinite(settle) ? settle : fallback;
  };

  function handsOf(timeline: Timeline): HandSpan[] {
    const spans: HandSpan[] = [];
    let open: HandSpan | null = null;
    for (const event of take.events) {
      if (event.type === 'grab') {
        open = { fromMs: event.atMs, toMs: null, speed: 0, samples: [event.atMs] };
        spans.push(open);
      } else if (event.type === 'drag') {
        open?.samples.push(event.atMs);
      } else if (open) {
        open.toMs = event.atMs;
        open.speed = edgeAt(timeline, showcase, event.atMs, levels).velocity;
        open = null;
      }
    }
    return spans;
  }

  /** Everything the page shows follows from the take and the spec, and is rebuilt here. */
  function derive() {
    if (!geometry) return;
    stale = false;
    const { timeline, steps } = replay(take.events, take.initialState, take.startMs);
    const pressesOnly = take.events.every((event) => event.type === 'command');
    const marker = dragging ?? (pressesOnly && take.events.length > 1 ? take.events.length - 1 : null);
    const ghost = marker === null ? null : replay(take.events.filter((_, i) => i !== marker), take.initialState, take.startMs).timeline;
    const first = take.events[0]?.atMs ?? take.startMs;
    const last = take.events[take.events.length - 1]?.atMs ?? first;
    const rival = rivalSpec ? replay(take.events, take.initialState, take.startMs, undefined, rivalSpec).timeline : null;
    const held = lastMark(timeline).hand !== null;
    const rest = Math.max(restOf(timeline, last), ghost ? restOf(ghost, last) : 0, rival ? restOf(rival, last) : 0, last);
    const start = first - LEAD_MS;
    const needed = held
      ? Math.ceil((rest + TAIL_MS - start) / HELD_STEP_MS + 0.35) * HELD_STEP_MS
      : Math.ceil((rest + TAIL_MS - start) / WINDOW_STEP_MS) * WINDOW_STEP_MS;
    const domain = lockedDomain ?? { start, end: start + Math.max(WINDOW_MS, needed) };
    snapshot = {
      spec,
      take,
      timeline,
      ghost,
      rival,
      rivalSpec,
      levels,
      geometry,
      steps,
      domain,
      takeEnd: restOf(timeline, last) + TAIL_MS,
      phase,
      moving,
      held,
      hands: handsOf(timeline),
      state: controller.getState(),
      slow,
      marker,
      epoch,
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
    if (stale) derive();
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
    holding = null;
    time = t;
    moving = false;
    phase = 'paused';
  }

  /** Starts a new take from whatever the panel is doing now. */
  function freshTake(t: number) {
    const initialState = controller.getState();
    take = { startMs: t - 2 * LEAD_MS, initialState, events: [], scripted: false, name: null };
    epoch += 1;
    const { timeline } = replay([], initialState, take.startMs);
    controller.setSpec({ ...spec, initialState });
    controller.load(timeline, t);
    controller.resume();
  }

  /** Keeps the take up to t and lets time run on from exactly there, speed intact. */
  function continueFrom(t: number) {
    const events = take.events.filter((event) => event.atMs <= t);
    // A hand that was on the component at t in the take is nobody's hand now, so it lets go there.
    const last = events[events.length - 1];
    if (last && (last.type === 'grab' || last.type === 'drag')) events.push({ atMs: t, type: 'release' });
    take = { ...take, scripted: false, name: null, events };
    epoch += 1;
    const { timeline } = replay(take.events, take.initialState, take.startMs, t);
    controller.setSpec({ ...spec, initialState: take.initialState });
    controller.load(timeline, t);
    controller.resume();
  }

  function dismissPending() {
    cancelPending?.();
    cancelPending = null;
  }

  /** Brings the panel to life at the moment being shown, so that input lands there. */
  function wake() {
    dismissPending();
    if (controller.isFrozen()) {
      const timeline = snapshot!.timeline;
      if (time >= restOf(timeline, Number.POSITIVE_INFINITY) && !pendingQueue(timeline)) freshTake(time);
      else continueFrom(time);
    } else if (!moving) {
      freshTake(controller.now());
    }
    phase = 'live';
  }

  /** The one path for every command, from the panel's own buttons and from the toolbar. */
  function send(command: string) {
    wake();
    holding = null;
    controller.send(command);
  }

  const other = (command: string) => (command === showcase.go ? showcase.back : showcase.go);

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

    /**
     * A hand takes hold of the component, wherever it is and whatever it is doing. Which command
     * it takes hold of follows from the state: the one that leaves it. Returns false when the
     * component is somewhere a hand has no say, such as a third state.
     */
    grab() {
      if (!snapshot || holding) return false;
      // Held at a moment of a take, the controller is in the state of that moment.
      const state = controller.getState();
      const command = state === showcase.from ? showcase.go : state === showcase.to ? showcase.back : null;
      if (!command || span() === 0) return false;
      wake();
      const edge = edgeAt(controller.getTimeline()!, showcase, controller.now(), levels).position;
      if (!controller.grab(command, onGrid(progressOf(command, edge)))) return false;
      holding = command;
      return true;
    },
    /** Where the followed edge is right now, for a hand that is about to take hold of it. */
    edge() {
      const timeline = controller.isFrozen() ? snapshot?.timeline : controller.getTimeline();
      return timeline ? edgeAt(timeline, showcase, controller.isFrozen() ? time : controller.now(), levels).position : levels.low;
    },
    /** Moves the hand to put the followed edge at `edge`, in pixels from the top of the component. */
    drag(edge: number) {
      if (holding) controller.drag(onGrid(progressOf(holding, edge)));
    },
    /**
     * The hand lets go. A hand moving fast enough to pass the middle shortly carries on that way,
     * and anything else settles toward the nearer end. Either way the spring starts from the
     * hand's position and speed.
     */
    release() {
      if (!holding) return;
      const command = holding;
      holding = null;
      const reading = edgeAt(controller.getTimeline()!, showcase, controller.now(), levels);
      const sign = command === showcase.go ? 1 : -1;
      const ahead = progressOf(command, reading.position) + ((reading.velocity * sign) / (span() || 1)) * THROW_LOOKAHEAD_S;
      if (ahead >= 0.5) controller.release();
      else controller.send(other(command));
    },
    holding: () => holding !== null,

    setGeometry(next: Geometry, nextLevels: Levels) {
      const first = geometry === null;
      // Measuring again and finding the same layout changes nothing, so nothing is worked out again.
      const key = JSON.stringify([next, nextLevels]);
      if (key === geometryKey) return;
      geometryKey = key;
      geometry = next;
      levels = nextLevels;
      epoch += 1;
      if (first) take = placeTake(start.take);
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

    /** Runs the whole take again, for a second copy of the component to follow. */
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

    /** Puts another take on the stage, as one of the page's examples or from a link, and plays it. */
    loadTake(given: TakeSource, play: boolean) {
      if (!geometry) return;
      dismissPending();
      take = placeTake(given);
      epoch += 1;
      dragging = null;
      lockedDomain = null;
      derive();
      if (!snapshot) return;
      if (play && !reducedMotion()) {
        startPlaying(snapshot.domain.start);
      } else {
        hold(snapshot.takeEnd);
        publish();
        emit();
      }
    },

    setSpec(next: MotionSpec, replayAfter: boolean, view: Element | null) {
      dismissPending();
      const wasAtEnd = snapshot !== null && atEnd();
      spec = next;
      epoch += 1;
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
      take = { ...take, name: take.name === 'reverse' ? take.name : null, events: events.map((event, i) => (i === index ? { ...event, atMs: next } : event)) };
      epoch += 1;
      phase = 'paused';
      moving = false;
      derive();
      hold(next);
      publish();
      emit();
    },

    /** Works a take out under the motion as it stands, for a strip to draw. */
    preview(given: TakeSource): Preview | null {
      if (!geometry) return null;
      const placed = placeTake(given);
      const { timeline } = replay(placed.events, placed.initialState, 0);
      const last = placed.events[placed.events.length - 1]?.atMs ?? LEAD_MS;
      return { timeline, startMs: LEAD_MS, endMs: restOf(timeline, last) };
    },

    /** Races the take under a second spec, or stops when given null. Nothing else changes. */
    setRival(next: MotionSpec | null) {
      if (next === rivalSpec) return;
      rivalSpec = next;
      derive();
      queueMicrotask(emit);
    },

    /** The followed edge at a moment of the take shown. */
    reading(t: number, of: 'take' | 'rival' = 'take'): { position: number; velocity: number } {
      const timeline = of === 'rival' ? snapshot!.rival : snapshot!.timeline;
      return edgeAt(timeline ?? snapshot!.timeline, showcase, t, levels);
    },
  };
}
