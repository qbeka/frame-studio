import type { Rects } from '../../packages/studio/runtime/spec';
import { inspectChannel, type Timeline } from '../../packages/studio/runtime/timeline';
import type { Showcase } from './showcase';

/** Where the followed edge rests in the two states, and where the component cuts it off. */
export interface Levels {
  low: number;
  high: number;
  /** The bottom of the component when it clips its contents, as a sheet's screen does. */
  clip: number;
}

export function levelsOf(showcase: Showcase, geometry: Record<string, Rects>, rootHeight: number): Levels {
  const { target, edge } = showcase.track;
  const at = (state: string) => {
    const rect = geometry[state]?.[target];
    if (!rect) return rootHeight;
    return edge === 'top' ? rect.y : rect.y + rect.height;
  };
  return { low: at(showcase.from), high: at(showcase.to), clip: edge === 'top' ? rootHeight : Number.POSITIVE_INFINITY };
}

/** Whether the timeline draws this target at t. A target that has left is drawn until its exit ends. */
function drawnAt(timeline: Timeline, id: string, t: number): boolean {
  const { marks, spec } = timeline;
  let mark = marks[0]!;
  for (let i = marks.length - 1; i > 0; i -= 1) {
    if (marks[i]!.atMs <= t) {
      mark = marks[i]!;
      break;
    }
  }
  return spec.states[mark.state]!.targets[id]!.present || t < (mark.targetSettleMs[id] ?? mark.atMs);
}

/** The followed edge at t: its place in pixels from the top of the component, and its speed. */
export function edgeAt(timeline: Timeline, showcase: Showcase, t: number, levels: Levels): { position: number; velocity: number } {
  const { target, edge } = showcase.track;
  const y = inspectChannel(timeline, target, 'y', t);
  if (edge === 'top') {
    if (!drawnAt(timeline, target, t) || y.position >= levels.clip) return { position: levels.clip, velocity: 0 };
    return { position: y.position, velocity: y.velocity };
  }
  const height = inspectChannel(timeline, target, 'height', t);
  return { position: y.position + height.position, velocity: y.velocity + height.velocity };
}

export interface Extent {
  x: number;
  width: number;
  top: number;
  bottom: number;
  drawn: boolean;
}

/** The box of the followed target at t, cut off where the component cuts it off. */
export function extentAt(timeline: Timeline, showcase: Showcase, t: number, levels: Levels): Extent {
  const { target } = showcase.track;
  const read = (name: 'x' | 'y' | 'width' | 'height') => inspectChannel(timeline, target, name, t).position;
  const top = read('y');
  const bottom = Math.min(levels.clip, top + read('height'));
  return { x: read('x'), width: read('width'), top: Math.min(top, bottom), bottom, drawn: drawnAt(timeline, target, t) && top < levels.clip };
}
