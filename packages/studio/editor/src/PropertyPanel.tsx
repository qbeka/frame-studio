import { useId, useState } from 'react';
import type {
  Curve,
  InterruptionRule,
  MotionSpec,
  PropertyGroup,
  StateTargetValue,
  TransitionSpec,
} from '../../runtime/spec';
import { describeSpring, springAt } from '../../runtime/spring';
import { tweenAt } from '../../runtime/tween';
import { LIMITS } from '../../authoring/parse';
import { NumberField } from './NumberField';
import { PRESETS } from './presets';
import type { Selection } from './StatePanel';
import type { ProjectStore } from './store';
import type { Session } from './session';

type Edit = (update: (spec: MotionSpec) => MotionSpec, group: string | null) => void;

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const PREVIEW = { width: 240, height: 56, samples: 60 };

/** The curve from rest, drawn small, so a preset or a number can be judged before a take exists. */
function CurvePreview({ curve, settle }: { curve: Curve; settle: MotionSpec['settle'] }) {
  const ms = curve.type === 'spring' ? Math.max(1, describeSpring(curve, settle).settleMs) : Math.max(1, curve.durationMs);
  const at = (t: number) => (curve.type === 'spring' ? springAt(curve, 0, 0, 1, t / 1000).position : tweenAt(curve, 0, 1, t).position);
  const y = (value: number) => 46 - value * 34;
  let d = '';
  for (let i = 0; i <= PREVIEW.samples; i += 1) {
    const t = (ms * i) / PREVIEW.samples;
    d += `${i === 0 ? 'M' : 'L'}${((i / PREVIEW.samples) * PREVIEW.width).toFixed(1)} ${y(at(t)).toFixed(1)}`;
  }
  return (
    <svg className="curve-preview" viewBox={`0 0 ${PREVIEW.width} ${PREVIEW.height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={0} x2={PREVIEW.width} y1={y(1)} y2={y(1)} className="curve-preview-target" />
      <line x1={0} x2={PREVIEW.width} y1={y(0)} y2={y(0)} className="curve-preview-rest" />
      <path d={d} className="curve-preview-path" />
    </svg>
  );
}

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
      <CurvePreview curve={curve} settle={settle} />
      <div className="presets" role="group" aria-label="Presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="chip"
            aria-pressed={JSON.stringify(preset.curve) === JSON.stringify(curve)}
            onClick={() => onChange(preset.curve, `${group}.preset.${preset.name}`)}
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
              ? `Passes its target by ${(facts!.overshoot * 100).toFixed(1)}% of the distance`
              : 'Does not pass its target when starting from rest'}{' '}
            and settles in about {Math.round(facts!.settleMs)} ms over 100 px
          </p>
        </>
      ) : (
        <>
          <NumberField label="Duration" unit="ms" value={curve.durationMs} min={LIMITS.durationMs[0]} max={LIMITS.durationMs[1]} step={10}
            onChange={(durationMs) => onChange({ ...curve, durationMs }, `${group}.duration`)} />
          <p className="hint">A timed curve keeps position through an interruption but drops speed. A spring keeps both.</p>
        </>
      )}
    </div>
  );
}

function withTransition(spec: MotionSpec, id: string, update: (t: TransitionSpec) => TransitionSpec): MotionSpec {
  return { ...spec, transitions: spec.transitions.map((t) => (t.id === id ? update(t) : t)) };
}

const GROUPS: PropertyGroup[] = ['position', 'size', 'opacity', 'scale'];

function InterruptionEditor({ spec, transition, edit }: { spec: MotionSpec; transition: TransitionSpec; edit: Edit }) {
  const group = `transition.${transition.id}.rules`;
  const change = (update: (rules: InterruptionRule[]) => InterruptionRule[], g: string | null = null) =>
    edit((s) => withTransition(s, transition.id, (t) => ({ ...t, interruptions: update(t.interruptions) })), g);
  const replaceAt = (index: number, rule: InterruptionRule, g: string | null = null) =>
    change((rules) => rules.map((r, i) => (i === index ? rule : r)), g);
  const commands = [{ value: '*', label: 'Any command' }, ...spec.commands.map((c) => ({ value: c, label: c }))];

  return (
    <section className="section">
      <h3>When interrupted</h3>
      {transition.interruptions.length === 0 ? (
        <p className="hint">No rule yet. Commands retarget from the current position and speed.</p>
      ) : null}
      {transition.interruptions.map((rule, index) => (
        <div className="rule" key={index} data-rule={rule.command}>
          <Select label="Command" value={rule.command} options={commands} onChange={(command) => replaceAt(index, { ...rule, command })} />
          <Select
            label="Do this"
            value={rule.policy}
            options={[
              { value: 'retarget', label: 'Retarget now' },
              { value: 'queue', label: 'Finish, then run' },
              { value: 'ignore', label: 'Ignore' },
            ]}
            onChange={(policy) => replaceAt(index, { ...rule, policy, curve: policy === 'retarget' ? rule.curve : null })}
          />
          {rule.policy === 'retarget' ? (
            <label className="check">
              <input
                type="checkbox"
                checked={rule.curve !== null}
                onChange={(event) => replaceAt(index, { ...rule, curve: event.target.checked ? PRESETS[1]!.curve : null })}
              />
              Use its own curve
            </label>
          ) : null}
          {rule.curve ? (
            <CurveEditor curve={rule.curve} settle={spec.settle} group={`${group}.${index}`} onChange={(curve, g) => replaceAt(index, { ...rule, curve }, g)} />
          ) : null}
          <button type="button" className="link" onClick={() => change((rules) => rules.filter((_, i) => i !== index))}>
            Remove rule
          </button>
        </div>
      ))}
      <button
        type="button"
        className="link"
        onClick={() => change((rules) => [...rules, { command: spec.commands[0] ?? '*', policy: 'retarget', curve: null }])}
      >
        Add rule
      </button>
    </section>
  );
}

function TransitionPanel({ spec, transition, edit }: { spec: MotionSpec; transition: TransitionSpec; edit: Edit }) {
  const [scope, setScope] = useState('all');
  const group = `transition.${transition.id}`;
  const [targetId, property] = scope.split('.') as [string, PropertyGroup];
  const override = scope === 'all' ? undefined : transition.targets[targetId]?.[property];
  const timing = override ?? transition.timing;

  const scopes = [
    { value: 'all', label: 'All targets' },
    ...Object.entries(spec.targets).flatMap(([id, target]) =>
      GROUPS.filter((g) => !(g === 'scale' && target.text)).map((g) => ({
        value: `${id}.${g}`,
        label: `${id} ${g}${transition.targets[id]?.[g] ? ' (own)' : ''}`,
      })),
    ),
  ];

  function setTiming(next: typeof timing, g: string) {
    edit(
      (s) =>
        withTransition(s, transition.id, (t) =>
          scope === 'all'
            ? { ...t, timing: next }
            : { ...t, targets: { ...t.targets, [targetId]: { ...t.targets[targetId], [property]: next } } },
        ),
      `${g}.${scope}`,
    );
  }

  function clearOverride() {
    edit(
      (s) =>
        withTransition(s, transition.id, (t) => {
          const groups = { ...t.targets[targetId] };
          delete groups[property];
          const targets = { ...t.targets, [targetId]: groups };
          if (Object.keys(groups).length === 0) delete targets[targetId];
          return { ...t, targets };
        }),
      null,
    );
  }

  return (
    <div className="properties">
      <header className="properties-head">
        <h2>
          {spec.states[transition.from]?.label} to {spec.states[transition.to]?.label}
        </h2>
        <p className="tag">Runs on {transition.command}</p>
      </header>
      <section className="section section-first">
        <h3>Curve</h3>
        <Select label="Applies to" value={scope} options={scopes} onChange={setScope} />
        <CurveEditor curve={timing.curve} settle={spec.settle} group={group} onChange={(curve, g) => setTiming({ ...timing, curve }, g)} />
        <NumberField label="Delay" unit="ms" value={timing.delayMs} min={LIMITS.delayMs[0]} max={LIMITS.delayMs[1]} step={10}
          onChange={(delayMs) => setTiming({ ...timing, delayMs }, `${group}.delay`)} />
        {override ? (
          <button type="button" className="link" onClick={clearOverride}>
            Use the transition's curve
          </button>
        ) : null}
      </section>
      <InterruptionEditor spec={spec} transition={transition} edit={edit} />
      <section className="section">
        <h3>With reduced motion</h3>
        <Select
          label="Do this"
          value={transition.reducedMotion.policy}
          options={[
            { value: 'fade', label: 'Skip travel, fade' },
            { value: 'instant', label: 'Change at once' },
          ]}
          onChange={(policy) =>
            edit((s) => withTransition(s, transition.id, (t) => ({ ...t, reducedMotion: { ...t.reducedMotion, policy } })), null)
          }
        />
        {transition.reducedMotion.policy === 'fade' ? (
          <NumberField label="Fade" unit="ms" value={transition.reducedMotion.durationMs} min={0} max={2000} step={10}
            onChange={(durationMs) =>
              edit((s) => withTransition(s, transition.id, (t) => ({ ...t, reducedMotion: { ...t.reducedMotion, durationMs } })), `${group}.fade`)
            } />
        ) : null}
      </section>
    </div>
  );
}

function StatePoses({ spec, id, edit }: { spec: MotionSpec; id: string; edit: Edit }) {
  const state = spec.states[id]!;
  const targetIds = Object.keys(spec.targets);
  const [targetId, setTargetId] = useState(targetIds[0]!);
  const pose = state.targets[targetId]!;
  const group = `state.${id}.${targetId}`;
  const setPose = (patch: Partial<StateTargetValue>, g: string | null) =>
    edit(
      (s) => ({
        ...s,
        states: {
          ...s.states,
          [id]: { ...s.states[id]!, targets: { ...s.states[id]!.targets, [targetId]: { ...pose, ...patch } } },
        },
      }),
      g,
    );

  return (
    <div className="properties">
      <header className="properties-head">
        <h2>{state.label}</h2>
        <p className="tag">State</p>
      </header>
      <p className="hint">A target's pose in this state, as an offset from its measured box.</p>
      <Select label="Target" value={targetId} options={targetIds.map((t) => ({ value: t, label: t }))} onChange={setTargetId} />
      <label className="check">
        <input
          type="checkbox"
          checked={pose.present}
          disabled={state.focusTarget === targetId}
          onChange={(event) => setPose({ present: event.target.checked }, null)}
        />
        In document flow in this state
      </label>
      <NumberField label="Opacity" unit="" value={pose.opacity} min={0} max={1} step={0.05} onChange={(opacity) => setPose({ opacity }, `${group}.opacity`)} />
      <NumberField label="X offset" unit="px" value={pose.xPx} min={-LIMITS.offsetPx} max={LIMITS.offsetPx} step={1} onChange={(xPx) => setPose({ xPx }, `${group}.x`)} />
      <NumberField label="Y offset" unit="px" value={pose.yPx} min={-LIMITS.offsetPx} max={LIMITS.offsetPx} step={1} onChange={(yPx) => setPose({ yPx }, `${group}.y`)} />
      {spec.targets[targetId]!.text ? (
        <p className="hint">This target holds text, so Frame never scales it.</p>
      ) : (
        <NumberField label="Scale" unit="" value={pose.scale} min={0} max={10} step={0.01} onChange={(scale) => setPose({ scale }, `${group}.scale`)} />
      )}
    </div>
  );
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
  const edit: Edit = (update, group) => {
    const next = update(spec);
    store.editSpec(() => next, group);
    // With a take on screen an edit reruns that exact sequence. That is the point of the take.
    const { take } = store.project;
    if (take) session.inspectAt(take, next, session.playhead.get());
  };

  if (selection.kind === 'transition') {
    const transition = spec.transitions.find((t) => t.id === selection.id);
    if (!transition) return <p className="hint">Choose a transition.</p>;
    return <TransitionPanel key={transition.id} spec={spec} transition={transition} edit={edit} />;
  }
  if (!spec.states[selection.id]) return <p className="hint">Choose a state.</p>;
  return <StatePoses key={selection.id} spec={spec} id={selection.id} edit={edit} />;
}
