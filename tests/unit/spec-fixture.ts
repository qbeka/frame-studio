import type { MotionSpec, Rects, SpringCurve, StateTargetValue } from 'frame-studio/pure';

export const spring: SpringCurve = { type: 'spring', stiffness: 380, damping: 24, mass: 1 };
const shown: StateTargetValue = { present: true, opacity: 1, xPx: 0, yPx: 0, scale: 1 };
const gone: StateTargetValue = { present: false, opacity: 0, xPx: 0, yPx: 8, scale: 1 };

/** A two state panel. `body` exists only when open, and `panel` tracks its bounds. */
export function panelSpec(overrides: Partial<MotionSpec> = {}): MotionSpec {
  const reducedMotion = { policy: 'fade', durationMs: 120 } as const;
  const timing = { curve: spring, delayMs: 0 };
  return {
    format: 'frame.motion',
    version: 1,
    component: { id: 'test.panel', version: '1.0.0' },
    initialState: 'closed',
    commands: ['open', 'close', 'poke'],
    targets: {
      panel: { bounds: 'surface', text: false, clipRadiusPx: 0 },
      body: { bounds: 'translate', text: true, clipRadiusPx: 0 },
    },
    states: {
      closed: { label: 'Closed', focusTarget: null, targets: { panel: shown, body: gone } },
      open: { label: 'Open', focusTarget: null, targets: { panel: shown, body: shown } },
    },
    transitions: [
      { id: 'open', from: 'closed', to: 'open', command: 'open', timing, targets: {}, interruptions: [], reducedMotion },
      { id: 'close', from: 'open', to: 'closed', command: 'close', timing, targets: {}, interruptions: [], reducedMotion },
    ],
    settle: { px: 0.1, pxPerSecond: 5, unit: 0.001, unitPerSecond: 0.05 },
    resize: 'retarget',
    ...overrides,
  };
}

export const closedRects: Rects = { panel: { x: 0, y: 0, width: 320, height: 60 } };
export const openRects: Rects = {
  panel: { x: 0, y: 0, width: 320, height: 260 },
  body: { x: 16, y: 72, width: 288, height: 140 },
};
export const geometry = (state: string) => (state === 'open' ? openRects : closedRects);
