import type { AnyRegistration, PropValue } from '../../../packages/studio/authoring/registration';
import type { MotionSpec } from '../../../packages/studio/runtime/spec';
import { cardRegistration, menuRegistration, sheetRegistration } from './frame.registrations';

/** What the page needs to know about a registered component, on top of its registration. */
export interface Showcase {
  id: string;
  /** The tab. */
  name: string;
  registration: AnyRegistration;
  spec: MotionSpec;
  /** The command the example starts with, and the one that interrupts it. */
  go: string;
  back: string;
  from: string;
  to: string;
  /** The edge the instrument follows, in pixels from the top of the component. */
  track: { target: string; edge: 'top' | 'bottom'; name: string };
  /** When the interruption lands in the example take, after the first command. */
  exampleDelayMs: number;
  /** The widest the component gets, so the page can reserve its place. */
  width: number;
  /** Corner radius of the followed target, for its ghost frames. */
  radius: number;
  /** Content that makes one state as tall as it can be, for the same reason. */
  tallest?: { state: string; props: Record<string, PropValue> };
  /** The folder name in the download. */
  exportName: string;
}

const define = (registration: AnyRegistration, rest: Omit<Showcase, 'registration' | 'spec'>): Showcase => ({
  ...rest,
  registration,
  spec: registration.defaultSpec!,
});

export const SHOWCASES: Showcase[] = [
  define(cardRegistration, {
    id: 'card',
    name: 'Expense card',
    go: 'open',
    back: 'cancel',
    from: 'compact',
    to: 'editing',
    track: { target: 'surface', edge: 'bottom', name: 'Height' },
    exampleDelayMs: 110,
    width: 340,
    radius: 14,
    tallest: { state: 'editing', props: { error: 'Enter an amount above zero, such as 18.40.' } },
    exportName: 'expense-panel-motion',
  }),
  define(menuRegistration, {
    id: 'menu',
    name: 'Status menu',
    go: 'open',
    back: 'close',
    from: 'closed',
    to: 'open',
    track: { target: 'surface', edge: 'bottom', name: 'Height' },
    exampleDelayMs: 100,
    width: 248,
    radius: 12,
    exportName: 'status-menu-motion',
  }),
  define(sheetRegistration, {
    id: 'sheet',
    name: 'Bottom sheet',
    go: 'open',
    back: 'close',
    from: 'closed',
    to: 'open',
    track: { target: 'sheet', edge: 'top', name: 'Top' },
    exampleDelayMs: 120,
    width: 300,
    radius: 18,
    exportName: 'stop-sheet-motion',
  }),
];

export const showcaseById = (id: string | null) => SHOWCASES.find((item) => item.id === id) ?? SHOWCASES[0]!;
