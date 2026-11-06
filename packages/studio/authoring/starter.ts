import type { MotionSpec, SpringCurve, StateSpec, StateTargetValue, TargetSpec, TransitionSpec } from '../runtime/spec';
import type { AnyRegistration } from './registration';
import type { Problem } from './parse';

export const DEFAULT_SPRING: SpringCurve = { type: 'spring', stiffness: 420, damping: 34, mass: 1 };

/** The first spec for a registration. Absent targets wait slightly below their box, faded out. */
export function createStarterSpec(registration: AnyRegistration): MotionSpec {
  const targetIds = Object.keys(registration.targets);
  const targets: Record<string, TargetSpec> = {};
  for (const id of targetIds) {
    const { bounds, text, clipRadiusPx } = registration.targets[id]!;
    targets[id] = { bounds, text, clipRadiusPx: clipRadiusPx ?? 0 };
  }
  const states: Record<string, StateSpec> = {};
  for (const [id, state] of Object.entries(registration.states)) {
    const poses: Record<string, StateTargetValue> = {};
    for (const target of targetIds) {
      const present = state.shows.includes(target);
      poses[target] = { present, opacity: present ? 1 : 0, xPx: 0, yPx: present ? 0 : 6, scale: 1 };
    }
    states[id] = { label: state.label, focusTarget: state.focus ?? null, targets: poses };
  }
  const transitions: TransitionSpec[] = registration.transitions.map((t) => ({
    ...t,
    timing: { curve: DEFAULT_SPRING, delayMs: 0 },
    targets: {},
    interruptions: [{ command: '*', policy: 'retarget', curve: null }],
    reducedMotion: { policy: 'fade', durationMs: 120 },
  }));
  return {
    format: 'frame.motion',
    version: 1,
    component: { id: registration.id, version: registration.version },
    initialState: registration.initialState,
    commands: Object.keys(registration.commands),
    targets,
    states,
    transitions,
    settle: { px: 0.1, pxPerSecond: 5, unit: 0.001, unitPerSecond: 0.05 },
    resize: 'retarget',
  };
}

/** A spec can only drive the component it was authored for. Says exactly why when it cannot. */
export function checkAgainstRegistration(spec: MotionSpec, registration: AnyRegistration): Problem[] {
  const problems: Problem[] = [];
  const compare = (path: string, inSpec: string[], declared: string[], noun: string) => {
    for (const id of inSpec) if (!declared.includes(id)) problems.push({ path: `${path}.${id}`, message: `This component has no ${noun} named "${id}".` });
    for (const id of declared) if (!inSpec.includes(id)) problems.push({ path: `${path}.${id}`, message: `The file is missing the ${noun} "${id}".` });
  };
  if (spec.component.id !== registration.id) {
    problems.push({ path: 'component.id', message: `The file is for "${spec.component.id}". This component is "${registration.id}".` });
    return problems;
  }
  compare('states', Object.keys(spec.states), Object.keys(registration.states), 'state');
  compare('targets', Object.keys(spec.targets), Object.keys(registration.targets), 'target');
  for (const command of spec.commands) {
    if (!registration.commands[command]) problems.push({ path: 'commands', message: `This component does not send "${command}".` });
  }
  return problems;
}
