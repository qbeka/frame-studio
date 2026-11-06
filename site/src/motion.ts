import authored from '../../fixtures/inspector/inspector.frame.json';
import type { Curve, InterruptionRule, MotionSpec, SpringCurve, TransitionSpec } from '../../packages/studio/runtime/spec';

export type Policy = InterruptionRule['policy'];

export const BASE = authored.spec as unknown as MotionSpec;
export const STATES = Object.keys(BASE.states);

export const RULES: { policy: Policy; label: string; note: string }[] = [
  { policy: 'retarget', label: 'Reverse from here', note: 'Cancel takes over at once, from the current height and speed.' },
  { policy: 'queue', label: 'Finish first', note: 'The panel finishes opening, then Cancel runs.' },
  { policy: 'ignore', label: 'Ignore it', note: 'Cancel is dropped and the panel stays open.' },
];

/** The studio's spring presets. Open starts on Quiet, the authored curve. */
export const FEELS: { name: string; curve: SpringCurve }[] = [
  { name: 'Quiet', curve: { type: 'spring', stiffness: 420, damping: 34, mass: 1 } },
  { name: 'Firm', curve: { type: 'spring', stiffness: 700, damping: 48, mass: 1 } },
  { name: 'Soft', curve: { type: 'spring', stiffness: 170, damping: 24, mass: 1 } },
  { name: 'Lively', curve: { type: 'spring', stiffness: 520, damping: 20, mass: 1 } },
];

export type CurveId = 'open' | 'cancel' | 'interrupt';

export const CURVES: { id: CurveId; label: string; note: string }[] = [
  { id: 'open', label: 'Open', note: 'This runs whenever Open starts.' },
  { id: 'cancel', label: 'Cancel', note: 'This runs when Cancel lands at rest.' },
  { id: 'interrupt', label: 'Mid flight', note: 'This runs when Cancel reverses.' },
];

export const TARGET_NAMES: Record<string, string> = {
  surface: 'Surface',
  content: 'Content',
  summary: 'Summary',
  open: 'Button',
  form: 'Form',
  receipt: 'Receipt',
};

function transition(spec: MotionSpec, id: string): TransitionSpec {
  return spec.transitions.find((item) => item.id === id)!;
}

function withTransition(spec: MotionSpec, id: string, change: (item: TransitionSpec) => TransitionSpec): MotionSpec {
  return { ...spec, transitions: spec.transitions.map((item) => (item.id === id ? change(item) : item)) };
}

export function policyOf(spec: MotionSpec): Policy {
  return transition(spec, 'open').interruptions.find((rule) => rule.command === 'cancel')!.policy;
}

export function withPolicy(spec: MotionSpec, policy: Policy): MotionSpec {
  return withTransition(spec, 'open', (item) => ({
    ...item,
    interruptions: item.interruptions.map((rule) => (rule.command === 'cancel' ? { ...rule, policy } : rule)),
  }));
}

export function curveOf(spec: MotionSpec, id: CurveId): SpringCurve {
  const open = transition(spec, 'open');
  const curve: Curve | null | undefined =
    id === 'interrupt' ? open.interruptions.find((rule) => rule.command === 'cancel')!.curve : transition(spec, id).timing.curve;
  return curve as SpringCurve;
}

export function withCurve(spec: MotionSpec, id: CurveId, curve: SpringCurve): MotionSpec {
  if (id === 'interrupt') {
    return withTransition(spec, 'open', (item) => ({
      ...item,
      interruptions: item.interruptions.map((rule) => (rule.command === 'cancel' ? { ...rule, curve } : rule)),
    }));
  }
  return withTransition(spec, id, (item) => ({ ...item, timing: { ...item.timing, curve } }));
}

export function feelOf(spec: MotionSpec): string | null {
  const { stiffness, damping } = curveOf(spec, 'open');
  return FEELS.find((feel) => feel.curve.stiffness === stiffness && feel.curve.damping === damping)?.name ?? null;
}

/** Per target opacity timings that a selected curve can override. Mid flight has none. */
export function overridesOf(spec: MotionSpec, id: CurveId) {
  if (id === 'interrupt') return [];
  return Object.entries(transition(spec, id).targets).flatMap(([target, groups]) => {
    const timing = groups.opacity;
    return timing && timing.curve.type === 'tween'
      ? [{ target, name: `${TARGET_NAMES[target] ?? target} fade`, durationMs: timing.curve.durationMs, delayMs: timing.delayMs }]
      : [];
  });
}

export function withOverride(spec: MotionSpec, id: CurveId, target: string, durationMs: number): MotionSpec {
  return withTransition(spec, id, (item) => {
    const groups = item.targets[target]!;
    const timing = groups.opacity!;
    if (timing.curve.type !== 'tween') return item;
    const opacity = { ...timing, curve: { ...timing.curve, durationMs } };
    return { ...item, targets: { ...item.targets, [target]: { ...groups, opacity } } };
  });
}
