import { createController } from '../../packages/studio/runtime/controller';
import type { FrameOptions } from '../../packages/studio/runtime/controller';
import type { MotionSpec, Rects, TakeEvent } from 'frame-studio/pure';

/** A hand-stepped clock and just enough DOM to run the real controller in Node. */
export function fakeClock() {
  let t = 1000;
  let waiting: (() => void) | null = null;
  return {
    now: () => t,
    requestFrame(callback: () => void) {
      waiting = callback;
      return () => (waiting = null);
    },
    set(next: number) {
      t = next;
    },
    frame(next: number) {
      t = next;
      const run = waiting;
      waiting = null;
      run?.();
    },
    waiting: () => waiting !== null,
  };
}

export function fakeElement(rect: () => { left: number; top: number; width: number; height: number }) {
  const attributes = new Set<string>();
  const element: any = {
    style: {},
    inert: false,
    isConnected: true,
    clientLeft: 0,
    clientTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    offsetParent: null,
    setAttribute: (key: string) => attributes.add(key),
    removeAttribute: (key: string) => attributes.delete(key),
    hasAttribute: (key: string) => attributes.has(key),
    getBoundingClientRect: rect,
    closest: () => (element.inert ? element : null),
    focus() {
      (globalThis as any).document.activeElement = element;
    },
    matches: () => true,
    querySelector: () => null,
    contains: () => false,
    addEventListener() {},
    removeEventListener() {},
  };
  return element;
}

/**
 * Mounts a real controller. React is replaced by one rule: after any notification, call `commit`,
 * which is what the layout effect does. `geometry` gives the layout of the current state.
 */
export function mount(spec: MotionSpec, geometry: (state: string) => Rects, options: FrameOptions = {}) {
  (globalThis as any).document = { activeElement: null, body: {} };
  const clock = fakeClock();
  const warnings: unknown[] = [];
  const events: TakeEvent[] = [];
  const controller = createController(spec, {
    clock,
    reducedMotion: false,
    ...options,
    onWarning: (warning) => warnings.push(warning),
    onEvent: (event) => events.push(structuredClone(event)),
  });
  const box = (id: string) => () => {
    const r = geometry(controller.getState())[id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { left: r.x, top: r.y, width: r.width, height: r.height };
  };
  const root = fakeElement(() => ({ left: 0, top: 0, width: 999, height: 999 }));
  controller.setRoot(root);
  const elements: Record<string, any> = {};
  for (const id of Object.keys(spec.targets)) {
    elements[id] = fakeElement(box(id));
    controller.setTarget(id, elements[id]);
  }
  controller.commit();
  return { controller, clock, elements, warnings, events, root };
}
