import { useState, type ChangeEvent } from 'react';
import type { MotionSpec } from '../../packages/studio/runtime/spec';
import {
  BASE,
  CURVES,
  FEELS,
  RULES,
  curveOf,
  feelOf,
  overridesOf,
  policyOf,
  withCurve,
  withOverride,
  withPolicy,
  type CurveId,
} from './motion';
import type { Session, Snapshot } from './session';

const OUTCOME: Record<string, string> = { start: 'Ran', queue: 'Waited', ignore: 'Ignored', reject: 'Refused' };

function Range({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="range" data-disabled={disabled || undefined}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-disabled={disabled || undefined}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (!disabled) onChange(Number(event.target.value));
        }}
      />
      <output>{value}{unit}</output>
    </label>
  );
}

export function TryIt({ snap, onChange }: { snap: Snapshot; onChange: (spec: MotionSpec, replay: boolean) => void }) {
  const policy = policyOf(snap.spec);
  const feel = feelOf(snap.spec);
  const rule = RULES.find((item) => item.policy === policy)!;
  return (
    <div className="choices">
      <fieldset>
        <legend>When Cancel lands</legend>
        <div className="stack" role="group" aria-label="What Cancel does while the panel is opening">
          {RULES.map((item) => (
            <button key={item.policy} type="button" className="control" aria-pressed={item.policy === policy} onClick={() => onChange(withPolicy(snap.spec, item.policy), true)}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="note">{rule.note}</p>
      </fieldset>
      <fieldset>
        <legend>How Open feels</legend>
        <div className="row" role="group" aria-label="Spring for Open">
          {FEELS.map((item) => (
            <button key={item.name} type="button" className="control" aria-pressed={item.name === feel} onClick={() => onChange(withCurve(snap.spec, 'open', item.curve), true)}>
              {item.name}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function Inspect({ snap, session, onChange }: { snap: Snapshot; session: Session; onChange: (spec: MotionSpec, replay: boolean) => void }) {
  const [selected, setSelected] = useState<CurveId>('open');
  const curve = curveOf(snap.spec, selected);
  const about = CURVES.find((item) => item.id === selected)!;
  const unused = selected === 'interrupt' && policyOf(snap.spec) !== 'retarget';
  const overrides = overridesOf(snap.spec, selected);
  const origin = snap.domain.start + 60;
  const changed = snap.spec !== BASE && JSON.stringify(snap.spec) !== JSON.stringify(BASE);

  return (
    <div className="inspect">
      <div className="row" role="group" aria-label="Curve to edit">
        {CURVES.map((item) => (
          <button key={item.id} type="button" className="control" aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="about">
        <p className="note">{unused ? 'Only Reverse from here uses this.' : about.note}</p>
        <button type="button" className="control reset" aria-disabled={!changed || undefined} onClick={() => { if (changed) onChange(BASE, false); }}>
          Reset motion
        </button>
      </div>
      <Range label="Stiffness" value={curve.stiffness} min={60} max={1000} step={10} unit="" disabled={unused} onChange={(stiffness) => onChange(withCurve(snap.spec, selected, { ...curve, stiffness }), false)} />
      <Range label="Damping" value={curve.damping} min={8} max={80} step={1} unit="" disabled={unused} onChange={(damping) => onChange(withCurve(snap.spec, selected, { ...curve, damping }), false)} />

      <h2>Per target</h2>
      {overrides.length === 0 ? <p className="note">This curve moves every target together.</p> : null}
      {overrides.map((item) => (
        <Range key={item.target} label={item.name} value={item.durationMs} min={0} max={400} step={10} unit=" ms" onChange={(durationMs) => onChange(withOverride(snap.spec, selected as Exclude<CurveId, 'interrupt'>, item.target, durationMs), false)} />
      ))}

      <h2>Recorded commands</h2>
      <ol className="commands">
        {snap.steps.map((step, i) => (
          <li key={`${step.atMs}-${i}`}>
            <button type="button" className="control" onClick={() => session.seek(step.atMs)}>
              <span className="at">{Math.round(step.atMs - origin)} ms</span>
              <span className="name">{step.command}</span>
              <span className="outcome">{OUTCOME[step.outcome]}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
