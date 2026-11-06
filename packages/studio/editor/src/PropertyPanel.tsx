import type { Curve, MotionSpec, TransitionSpec } from '../../runtime/spec';
import { describeSpring } from '../../runtime/spring';
import { LIMITS } from '../../authoring/parse';
import { NumberField } from './NumberField';
import { PRESETS } from './presets';
import type { Selection } from './StatePanel';
import type { ProjectStore } from './store';
import type { Session } from './session';

function CurveEditor({
  curve,
  settle,
  group,
  onChange,
}: {
  curve: Curve;
  settle: MotionSpec['settle'];
  group: string;
  onChange: (curve: Curve, group: string) => void;
}) {
  const facts = curve.type === 'spring' ? describeSpring(curve, settle) : null;
  return (
    <div className="curve">
      <div className="presets" role="group" aria-label="Presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="chip"
            aria-pressed={JSON.stringify(preset.curve) === JSON.stringify(curve)}
            onClick={() => onChange(preset.curve, `${group}.preset`)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      {curve.type === 'spring' ? (
        <>
          <NumberField label="Stiffness" unit="N/m" value={curve.stiffness} min={LIMITS.stiffness[0]} max={LIMITS.stiffness[1]} step={10}
            onChange={(stiffness) => onChange({ ...curve, stiffness }, `${group}.stiffness`)} />
          <NumberField label="Damping" unit="N s/m" value={curve.damping} min={LIMITS.damping[0]} max={LIMITS.damping[1]} step={1}
            onChange={(damping) => onChange({ ...curve, damping }, `${group}.damping`)} />
          <NumberField label="Mass" unit="kg" value={curve.mass} min={LIMITS.mass[0]} max={LIMITS.mass[1]} step={0.1}
            onChange={(mass) => onChange({ ...curve, mass }, `${group}.mass`)} />
          <p className="hint">
            {facts!.overshoot > 0.0005
              ? `Passes its target by ${(facts!.overshoot * 100).toFixed(1)}% of the distance.`
              : 'Does not pass its target from rest.'}{' '}
            Settles in about {Math.round(facts!.settleMs)} ms over 100 px, meaning within {settle.px} px and {settle.pxPerSecond} px/s.
          </p>
        </>
      ) : (
        <>
          <NumberField label="Duration" unit="ms" value={curve.durationMs} min={LIMITS.durationMs[0]} max={LIMITS.durationMs[1]} step={10}
            onChange={(durationMs) => onChange({ ...curve, durationMs }, `${group}.duration`)} />
          <p className="hint">Timed curves keep position through an interruption but cannot carry speed. Use a spring for a reversal that keeps its momentum.</p>
        </>
      )}
    </div>
  );
}

function updateTransition(spec: MotionSpec, id: string, update: (t: TransitionSpec) => TransitionSpec): MotionSpec {
  return { ...spec, transitions: spec.transitions.map((t) => (t.id === id ? update(t) : t)) };
}

export function PropertyPanel({
  spec,
  selection,
  store,
  session,
}: {
  spec: MotionSpec;
  selection: Selection;
  store: ProjectStore;
  session: Session;
}) {
  function edit(update: (spec: MotionSpec) => MotionSpec, group: string) {
    const next = update(spec);
    store.editSpec(() => next, group);
    const { take } = store.project;
    if (take) session.inspectAt(take, next, session.playhead.get());
  }

  if (selection.kind === 'transition') {
    const transition = spec.transitions.find((t) => t.id === selection.id);
    if (!transition) return <p className="hint">Choose a transition.</p>;
    const group = `transition.${transition.id}`;
    return (
      <div className="properties">
        <h2>
          {spec.states[transition.from]?.label} to {spec.states[transition.to]?.label}
        </h2>
        <CurveEditor
          curve={transition.timing.curve}
          settle={spec.settle}
          group={group}
          onChange={(curve, g) => edit((s) => updateTransition(s, transition.id, (t) => ({ ...t, timing: { ...t.timing, curve } })), g)}
        />
        <NumberField label="Delay" unit="ms" value={transition.timing.delayMs} min={LIMITS.delayMs[0]} max={LIMITS.delayMs[1]} step={10}
          onChange={(delayMs) => edit((s) => updateTransition(s, transition.id, (t) => ({ ...t, timing: { ...t.timing, delayMs } })), `${group}.delay`)} />
      </div>
    );
  }

  const state = spec.states[selection.id];
  if (!state) return <p className="hint">Choose a state.</p>;
  return (
    <div className="properties">
      <h2>{state.label}</h2>
      <p className="hint">Each target's pose in this state, as an offset from its measured box.</p>
    </div>
  );
}
