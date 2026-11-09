import { inspectorRegistration } from '@frame-studio/fixture-inspector/registration';
import { defineRegistration, type AnyRegistration } from '../../../packages/studio/authoring/registration';
import { createStarterSpec } from '../../../packages/studio/authoring/starter';
import type { Curve, MotionSpec, SpringCurve, Timing, TransitionSpec } from '../../../packages/studio/runtime/spec';
import { StatusMenu, initialStatusMenuProps, STATUSES, type StatusMenuProps } from './StatusMenu';
import { StopSheet, initialStopSheetProps, SLOTS, type StopSheetProps } from './StopSheet';
import './showcase.css';

/**
 * The components on the project page, registered the same way as any other. The expense card is
 * the repository's fixture with a wrapper for its look. The menu and the sheet are declared here.
 */
const QUIET: SpringCurve = { type: 'spring', stiffness: 420, damping: 34, mass: 1 };
const FIRM: SpringCurve = { type: 'spring', stiffness: 700, damping: 48, mass: 1 };
const fade = (durationMs: number, delayMs = 0): Timing => ({ curve: { type: 'tween', durationMs, easing: [0.2, 0, 0, 1] }, delayMs });

function withTransitions(spec: MotionSpec, change: Record<string, Partial<TransitionSpec>>): MotionSpec {
  return { ...spec, transitions: spec.transitions.map((item) => ({ ...item, ...change[item.id] })) };
}

const retarget = (command: string, curve: Curve | null) => ({ command, policy: 'retarget' as const, curve });

export const cardRegistration: AnyRegistration = {
  ...inspectorRegistration,
  render: (context) => <div className="sc sc-card-wrap">{inspectorRegistration.render(context)}</div>,
};

const menuBase = defineRegistration<StatusMenuProps>({
  id: 'frame.showcase.status-menu',
  version: '1.0.0',
  initialState: 'closed',
  states: {
    closed: { label: 'Closed', shows: ['surface', 'content', 'trigger'], focus: 'trigger' },
    open: { label: 'Open', shows: ['surface', 'content', 'trigger', 'list'], focus: 'list' },
  },
  targets: {
    surface: { label: 'Surface', bounds: 'surface', text: false },
    content: { label: 'Content clip', bounds: 'clip', text: true, clipRadiusPx: 12 },
    trigger: { label: 'Button', bounds: 'translate', text: true },
    list: { label: 'List', bounds: 'translate', text: true },
  },
  commands: { open: { label: 'Open' }, close: { label: 'Close' } },
  transitions: [
    { id: 'open', from: 'closed', to: 'open', command: 'open' },
    { id: 'close', from: 'open', to: 'closed', command: 'close' },
  ],
  props: {
    status: { type: 'enum', label: 'Status', default: initialStatusMenuProps.status, options: STATUSES },
  },
  exampleTake: [
    { atMs: 0, command: 'open' },
    { atMs: 100, command: 'close' },
  ],
  reset() {},
  render: (context) => (
    <div className="sc sc-menu-wrap">
      <StatusMenu {...context} />
    </div>
  ),
});

const menuStarter = createStarterSpec(menuBase);
const menuSpec = withTransitions(
  {
    ...menuStarter,
    states: {
      ...menuStarter.states,
      closed: { ...menuStarter.states.closed!, targets: { ...menuStarter.states.closed!.targets, list: { present: false, opacity: 0, xPx: 0, yPx: -6, scale: 1 } } },
    },
  },
  {
    open: { timing: { curve: QUIET, delayMs: 0 }, targets: { list: { opacity: fade(160, 40) } }, interruptions: [retarget('close', FIRM)] },
    close: { timing: { curve: FIRM, delayMs: 0 }, targets: { list: { opacity: fade(90) } }, interruptions: [retarget('*', null)] },
  },
);
export const menuRegistration: AnyRegistration = { ...menuBase, defaultSpec: menuSpec };

const sheetBase = defineRegistration<StopSheetProps>({
  id: 'frame.showcase.stop-sheet',
  version: '1.0.0',
  initialState: 'closed',
  states: {
    closed: { label: 'Closed', shows: ['add'], focus: 'add' },
    open: { label: 'Open', shows: ['add', 'scrim', 'sheet'], focus: 'sheet' },
  },
  targets: {
    add: { label: 'Add button', bounds: 'translate', text: true },
    scrim: { label: 'Scrim', bounds: 'translate', text: false },
    sheet: { label: 'Sheet', bounds: 'translate', text: true },
  },
  commands: { open: { label: 'Open' }, close: { label: 'Close' } },
  transitions: [
    { id: 'open', from: 'closed', to: 'open', command: 'open' },
    { id: 'close', from: 'open', to: 'closed', command: 'close' },
  ],
  props: {
    name: { type: 'string', label: 'Stop', default: initialStopSheetProps.name },
    slot: { type: 'enum', label: 'Time of day', default: initialStopSheetProps.slot, options: SLOTS },
    added: { type: 'string', label: 'Added stop', default: '' },
    addedSlot: { type: 'string', label: 'Added time of day', default: '' },
  },
  exampleTake: [
    { atMs: 0, command: 'open' },
    { atMs: 120, command: 'close' },
  ],
  reset() {},
  render: (context) => (
    <div className="sc sc-phone-wrap">
      <StopSheet {...context} />
    </div>
  ),
});

/** How far below its place the sheet waits. A little more than its 216 px, so it starts off the screen. */
export const SHEET_TRAVEL_PX = 220;

const sheetStarter = createStarterSpec(sheetBase);
const sheetSpec = withTransitions(
  {
    ...sheetStarter,
    states: {
      ...sheetStarter.states,
      closed: {
        ...sheetStarter.states.closed!,
        targets: {
          ...sheetStarter.states.closed!.targets,
          scrim: { present: false, opacity: 0, xPx: 0, yPx: 0, scale: 1 },
          sheet: { present: false, opacity: 1, xPx: 0, yPx: SHEET_TRAVEL_PX, scale: 1 },
        },
      },
    },
  },
  {
    open: { timing: { curve: QUIET, delayMs: 0 }, targets: { scrim: { opacity: fade(200) } }, interruptions: [retarget('close', FIRM)] },
    close: { timing: { curve: FIRM, delayMs: 0 }, targets: { scrim: { opacity: fade(160) } }, interruptions: [retarget('*', null)] },
  },
);
export const sheetRegistration: AnyRegistration = { ...sheetBase, defaultSpec: sheetSpec };

export default [cardRegistration, menuRegistration, sheetRegistration];
