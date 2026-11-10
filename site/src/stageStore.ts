import type { MotionSpec } from '../../packages/studio/runtime/spec';
import type { Geometry } from './session';
import type { Showcase } from './showcase';
import type { Levels } from './trace';

/**
 * What the stage is showing, for the figures further down the page. They draw from the same
 * component, the same measured layout and the same springs, so tuning the stage redraws them.
 */
export interface StageView {
  showcase: Showcase;
  spec: MotionSpec;
  geometry: Geometry;
  levels: Levels;
}

let current: StageView | null = null;
const listeners = new Set<() => void>();

export function publishStage(view: StageView) {
  current = view;
  for (const listener of listeners) listener();
}

export const readStage = () => current;

export function subscribeStage(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
