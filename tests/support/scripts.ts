import type { Step } from './sync.ts';

/**
 * Frozen input sequences for the inspector. Times are milliseconds on the manual clock. Each one
 * targets a behavior from the brief. The two pages run the same list, so neither can drift.
 */
export interface Script {
  name: string;
  covers: string;
  steps: Step[];
  endMs: number;
}

export const SCRIPTS: Script[] = [
  {
    name: 'reversal',
    covers: 'One reversal, with its own curve, and a delayed opacity leg',
    steps: [{ atMs: 100, click: 'Edit expense' }, { atMs: 230, click: 'Cancel' }],
    endMs: 1000,
  },
  {
    name: 'repeated',
    covers: 'Repeated retargeting faster than anything settles',
    steps: [
      { atMs: 100, click: 'Edit expense' },
      { atMs: 180, click: 'Cancel' },
      { atMs: 240, click: 'Edit expense' },
      { atMs: 300, click: 'Cancel' },
      { atMs: 420, click: 'Edit expense' },
    ],
    endMs: 1300,
  },
  {
    name: 'save-pending',
    covers: 'Reversing a transition while a save is pending',
    steps: [
      { atMs: 100, click: 'Edit expense' },
      { atMs: 800, click: 'Save' },
      { atMs: 950, click: 'Keep editing' },
      { atMs: 1010, click: 'Cancel' },
    ],
    endMs: 1800,
  },
  {
    name: 'resize',
    covers: 'A layout change in the middle of a transition',
    steps: [{ atMs: 100, click: 'Edit expense' }, { atMs: 200, width: 300 }],
    endMs: 1000,
  },
];
