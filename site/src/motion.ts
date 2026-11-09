import type { Curve, InterruptionRule, MotionSpec, SpringCurve, TransitionSpec } from '../../packages/studio/runtime/spec';
import type { Showcase } from './showcase';

export type Policy = InterruptionRule['policy'];

export const RULES: { policy: Policy; label: string; short: string; note: (back: string) => string }[] = [
  { policy: 'retarget', label: 'Reverse from here', short: 'Reverse', note: (back) => `${back} takes over at once, from the current position and speed` },
  { policy: 'queue', label: 'Finish first', short: 'Finish first', note: (back) => `The motion runs to its end, then ${back} runs` },
  { policy: 'ignore', label: 'Ignore it', short: 'Ignore', note: (back) => `${back} is dropped, and the motion carries on` },
];

/** The studio's spring presets. Every component here starts on Quiet. */
export const FEELS: { name: string; curve: SpringCurve }[] = [
  { name: 'Quiet', curve: { type: 'spring', stiffness: 420, damping: 34, mass: 1 } },
  { name: 'Firm', curve: { type: 'spring', stiffness: 700, damping: 48, mass: 1 } },
  { name: 'Soft', curve: { type: 'spring', stiffness: 170, damping: 24, mass: 1 } },
  { name: 'Lively', curve: { type: 'spring', stiffness: 520, damping: 20, mass: 1 } },
];

export const STIFFNESS = { min: 60, max: 1000, step: 10 };
export const DAMPING = { min: 8, max: 80, step: 1 };

/** The first command's curve, the returning command's curve, and the one used mid flight. */
export type CurveId = 'go' | 'back' | 'interrupt';

export const label = (showcase: Showcase, command: string) => showcase.registration.commands[command]?.label ?? command;

export function curvesFor(showcase: Showcase): { id: CurveId; label: string; note: string }[] {
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);
  return [
    { id: 'go', label: go, note: `Runs whenever ${go} starts` },
    { id: 'back', label: back, note: `Runs when ${back} lands at rest` },
    { id: 'interrupt', label: 'Mid flight', note: `Runs when ${back} reverses ${go}` },
  ];
}

function transitionId(spec: MotionSpec, showcase: Showcase, id: 'go' | 'back'): string {
  const [command, from] = id === 'go' ? [showcase.go, showcase.from] : [showcase.back, showcase.to];
  return spec.transitions.find((item) => item.command === command && item.from === from)!.id;
}

function transition(spec: MotionSpec, showcase: Showcase, id: 'go' | 'back'): TransitionSpec {
  const wanted = transitionId(spec, showcase, id);
  return spec.transitions.find((item) => item.id === wanted)!;
}

function withTransition(spec: MotionSpec, id: string, change: (item: TransitionSpec) => TransitionSpec): MotionSpec {
  return { ...spec, transitions: spec.transitions.map((item) => (item.id === id ? change(item) : item)) };
}

function withRule(spec: MotionSpec, showcase: Showcase, change: (rule: InterruptionRule) => InterruptionRule): MotionSpec {
  return withTransition(spec, transitionId(spec, showcase, 'go'), (item) => ({
    ...item,
    interruptions: item.interruptions.map((rule) => (rule.command === showcase.back ? change(rule) : rule)),
  }));
}

const ruleOf = (spec: MotionSpec, showcase: Showcase) => transition(spec, showcase, 'go').interruptions.find((rule) => rule.command === showcase.back)!;

export const policyOf = (spec: MotionSpec, showcase: Showcase): Policy => ruleOf(spec, showcase).policy;

export const withPolicy = (spec: MotionSpec, showcase: Showcase, policy: Policy): MotionSpec => withRule(spec, showcase, (rule) => ({ ...rule, policy }));

export function curveOf(spec: MotionSpec, showcase: Showcase, id: CurveId): SpringCurve {
  const curve: Curve | null = id === 'interrupt' ? ruleOf(spec, showcase).curve : transition(spec, showcase, id).timing.curve;
  return curve as SpringCurve;
}

export function withCurve(spec: MotionSpec, showcase: Showcase, id: CurveId, curve: SpringCurve): MotionSpec {
  if (id === 'interrupt') return withRule(spec, showcase, (rule) => ({ ...rule, curve }));
  return withTransition(spec, transitionId(spec, showcase, id), (item) => ({ ...item, timing: { ...item.timing, curve } }));
}

export function feelOf(curve: SpringCurve): string | null {
  return FEELS.find((feel) => feel.curve.stiffness === curve.stiffness && feel.curve.damping === curve.damping)?.name ?? null;
}

export const sameSpec = (a: MotionSpec, b: MotionSpec) => a === b || JSON.stringify(a) === JSON.stringify(b);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snap = (value: number, range: { min: number; max: number; step: number }) =>
  clamp(Math.round(value / range.step) * range.step, range.min, range.max);

/** Stiffness and damping snapped to the sliders' own steps, so every control agrees. */
export const tidy = (curve: SpringCurve): SpringCurve => ({ ...curve, stiffness: snap(curve.stiffness, STIFFNESS), damping: snap(curve.damping, DAMPING) });
