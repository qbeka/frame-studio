import type { TakeItem } from './session';
import type { Showcase } from './showcase';

/**
 * The page's example takes. Two are presses at chosen moments. The others are a hand, written as
 * the pointer samples a hand would send, eight milliseconds apart. They go through the same entry
 * point as a visitor's hand: nothing here knows how the component moves.
 */
export interface TakeContext {
  /** How far through `command` the followed edge is at atMs, once these events have happened. */
  progressAt(events: TakeItem[], atMs: number, command: string): number;
}

export interface LibraryTake {
  id: string;
  name: string;
  /** What the take shows, for the tooltip and for a screen reader. */
  about: string;
  /** Events with times counted from the first one. */
  build(showcase: Showcase, context: TakeContext): TakeItem[];
}

const SAMPLE_MS = 8;
const GRID = 4096;
const onGrid = (value: number) => Math.round(value * GRID) / GRID;

/** A hand moving from one place to another. `shape` maps 0..1 of the time to 0..1 of the way. */
function stroke(fromMs: number, toMs: number, from: number, to: number, shape: (x: number) => number): TakeItem[] {
  const events: TakeItem[] = [];
  for (let t = fromMs + SAMPLE_MS; t <= toMs + 1e-6; t += SAMPLE_MS) {
    events.push({ atMs: t, type: 'drag', progress: onGrid(from + (to - from) * shape((t - fromMs) / (toMs - fromMs))) });
  }
  return events;
}

/** Still at both ends, the way a hand moves when it means to stop. */
const settle = (x: number) => x * x * x * (10 - 15 * x + 6 * x * x);
/** Still at the start and fastest at the end, the way a hand throws. */
const fling = (x: number) => x * x;

export const LIBRARY: LibraryTake[] = [
  {
    id: 'reverse',
    name: 'Reverse',
    about: 'One press, then the press that undoes it while the first is still moving',
    build: (showcase) => [
      { atMs: 0, type: 'command', command: showcase.go },
      { atMs: showcase.exampleDelayMs, type: 'command', command: showcase.back },
    ],
  },
  {
    id: 'double-tap',
    name: 'Double tap',
    about: 'Four presses in a third of a second, each landing while the last is still moving',
    build: (showcase) => [
      { atMs: 0, type: 'command', command: showcase.go },
      { atMs: 90, type: 'command', command: showcase.back },
      { atMs: 230, type: 'command', command: showcase.go },
      { atMs: 330, type: 'command', command: showcase.back },
    ],
  },
  {
    id: 'late-cancel',
    name: 'Late cancel',
    about: 'The press that undoes it lands when the motion has almost come to rest',
    build: (showcase) => [
      { atMs: 0, type: 'command', command: showcase.go },
      { atMs: 300, type: 'command', command: showcase.back },
    ],
  },
  {
    id: 'throw-and-catch',
    name: 'Throw and catch',
    about: 'A hand throws it open, catches it on the way and throws it back',
    build(showcase, context) {
      const events: TakeItem[] = [{ atMs: 0, type: 'grab', command: showcase.go, progress: 0 }];
      events.push(...stroke(0, 144, 0, 0.4, fling));
      events.push({ atMs: 148, type: 'release' });
      // The catch lands wherever the spring has carried it by then, which depends on the spring.
      const caught = context.progressAt(events, 300, showcase.back);
      events.push({ atMs: 300, type: 'grab', command: showcase.back, progress: caught });
      events.push(...stroke(300, 356, caught, caught + 0.02, settle));
      events.push(...stroke(356, 516, caught + 0.02, Math.min(0.96, caught + 0.5), fling));
      events.push({ atMs: 520, type: 'release' });
      return events;
    },
  },
  {
    id: 'slow-pull',
    name: 'Slow pull',
    about: 'A hand eases it part of the way, waits, and lets go',
    build(showcase) {
      const events: TakeItem[] = [{ atMs: 0, type: 'grab', command: showcase.go, progress: 0 }];
      events.push(...stroke(0, 520, 0, 0.44, settle));
      // No samples while the hand is still, exactly as a pointer sends none.
      events.push({ atMs: 800, type: 'command', command: showcase.back });
      return events;
    },
  },
];

export const libraryById = (id: string | null) => LIBRARY.find((take) => take.id === id) ?? null;
