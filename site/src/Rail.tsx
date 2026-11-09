import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { PropValue } from '../../packages/studio/authoring/registration';
import type { MotionSpec, SpringCurve } from '../../packages/studio/runtime/spec';
import { describeSpring } from '../../packages/studio/runtime/spring';
import { lastMark } from '../../packages/studio/runtime/timeline';
import { Follower } from './Follower';
import { springToLinear } from './linearEasing';
import { DAMPING, FEELS, RULES, STIFFNESS, curveOf, curvesFor, feelOf, label, policyOf, sameSpec, withCurve, withPolicy, type CurveId, type Policy } from './motion';
import { LEAD_MS, type Session, type Snapshot } from './session';
import type { Showcase } from './showcase';

export const announce = (text: string) => {
  const element = document.getElementById('status');
  if (element) element.textContent = text;
};

function Range({
  label: name,
  value,
  range,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fill = ((value - range.min) / (range.max - range.min)) * 100;
  return (
    <label className="range" data-disabled={disabled || undefined}>
      <span>{name}</span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-disabled={disabled || undefined}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (!disabled) onChange(Number(event.target.value));
        }}
      />
      <output>{value}</output>
    </label>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access can be refused. The older path still works from a click.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
}

/** A button that copies, says so, and keeps its width while its label changes. */
export function CopyButton({ text, name, className = 'control', children }: { text: () => string; name: string; className?: string; children: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const id = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(id);
  }, [state]);
  return (
    <button
      type="button"
      className={`${className} swap`}
      aria-label={name}
      data-copied={state === 'copied' || undefined}
      onClick={async () => {
        const done = await copyText(text());
        setState(done ? 'copied' : 'failed');
        announce(done ? `${name}, copied` : 'Copying was blocked by the browser');
      }}
    >
      <span className={state === 'idle' ? 'on' : ''}>{children}</span>
      <span className={state === 'copied' ? 'on' : ''}>Copied</span>
      <span className={state === 'failed' ? 'on' : ''}>Blocked</span>
    </button>
  );
}

export const specText = (curve: SpringCurve) => `{ type: 'spring', stiffness: ${curve.stiffness}, damping: ${curve.damping}, mass: ${curve.mass} }`;

type Change = (spec: MotionSpec, replay: boolean) => void;

export function Tune({ snap, showcase, onChange }: { snap: Snapshot; showcase: Showcase; onChange: Change }) {
  const [selected, setSelected] = useState<CurveId>('go');
  const curves = useMemo(() => curvesFor(showcase), [showcase]);
  const curve = curveOf(snap.spec, showcase, selected);
  const policy = policyOf(snap.spec, showcase);
  const rule = RULES.find((item) => item.policy === policy)!;
  const about = curves.find((item) => item.id === selected)!;
  const unused = selected === 'interrupt' && policy !== 'retarget';
  const feel = feelOf(curve);
  const distance = Math.max(1, Math.abs(snap.levels.high - snap.levels.low));
  const facts = describeSpring(curve, snap.spec.settle, distance);
  const easing = useMemo(() => springToLinear(curve, distance, snap.spec.settle), [curve, distance, snap.spec.settle]);
  const changed = !sameSpec(snap.spec, showcase.spec);
  const back = label(showcase, showcase.back);
  const set = (next: SpringCurve, replay: boolean) => onChange(withCurve(snap.spec, showcase, selected, next), replay);

  return (
    <div className="tune">
      <section className="group">
        <header>
          <h2>Spring</h2>
          <div className="seg small" role="group" aria-label="Curve to edit">
            {curves.map((item) => (
              <button key={item.id} type="button" className="control" aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </header>
        <div className="seg" role="group" aria-label={`Presets for ${about.label}`}>
          {FEELS.map((item) => (
            <button key={item.name} type="button" className="control" aria-pressed={item.name === feel} onClick={() => set(item.curve, true)}>
              {item.name}
            </button>
          ))}
        </div>
        <Range label="Stiffness" value={curve.stiffness} range={STIFFNESS} disabled={unused} onChange={(stiffness) => set({ ...curve, stiffness }, false)} />
        <Range label="Damping" value={curve.damping} range={DAMPING} disabled={unused} onChange={(damping) => set({ ...curve, damping }, false)} />
        <p className="facts" id="facts">
          {unused ? (
            'Only Reverse from here uses this spring'
          ) : (
            <>
              <span>Ratio <b>{facts.dampingRatio.toFixed(2)}</b></span>
              <span>Settles <b>{Math.round(facts.settleMs)} ms</b></span>
              <span>{facts.overshoot > 0.0005 ? <>Overshoot <b>{(facts.overshoot * 100).toFixed(1)}%</b></> : 'No overshoot'}</span>
            </>
          )}
        </p>
      </section>

      <section className="group">
        <header>
          <h2>When {back} lands mid flight</h2>
        </header>
        <div className="seg" role="group" aria-label={`What ${back} does while the motion is running`}>
          {RULES.map((item) => (
            <button key={item.policy} type="button" className="control" aria-pressed={item.policy === policy} onClick={() => onChange(withPolicy(snap.spec, showcase, item.policy), true)}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="note">{rule.note(back)}</p>
      </section>

      <section className="group">
        <header>
          <h2>Take this spring</h2>
          <button type="button" className="control reset" aria-disabled={!changed || undefined} onClick={() => { if (changed) onChange(showcase.spec, false); }}>
            Reset motion
          </button>
        </header>
        <div className="code-row">
          <code id="spring-spec">{specText(curve)}</code>
          <CopyButton text={() => specText(curve)} name="Copy the spring as a Frame curve" className="control outline">Copy</CopyButton>
        </div>
        <div className="code-row">
          <code id="spring-css">{easing.durationMs}ms {easing.css}</code>
          <CopyButton text={() => `transition-duration: ${easing.durationMs}ms;\ntransition-timing-function: ${easing.css};`} name="Copy the spring as CSS linear easing" className="control outline">Copy</CopyButton>
        </div>
        <p className="note">The second line is this spring from rest as CSS, within 0.2% of its {Math.round(distance)} px, and CSS cannot start it from a speed</p>
      </section>
    </div>
  );
}

export interface RaceChoice {
  feel: string;
  policy: Policy;
}

/** The second spec in a race: this one, with another spring for the first command and another rule. */
export function rivalOf(spec: MotionSpec, showcase: Showcase, choice: RaceChoice): MotionSpec {
  const curve = FEELS.find((item) => item.name === choice.feel)!.curve;
  return withPolicy(withCurve(spec, showcase, 'go', curve), showcase, choice.policy);
}

const OUTCOME: Record<Policy, string> = { retarget: 'reverses', queue: 'finishes first', ignore: 'ignores it' };

export function Race({
  snap,
  showcase,
  session,
  props,
  choice,
  onChoice,
}: {
  snap: Snapshot;
  showcase: Showcase;
  session: Session;
  props: Record<string, PropValue>;
  choice: RaceChoice;
  onChoice: (choice: RaceChoice) => void;
}) {
  const origin = snap.domain.start + LEAD_MS;
  const ours = curveOf(snap.spec, showcase, 'go');
  const settles = (ms: number) => `${Math.max(0, Math.round(ms - origin))} ms`;
  const a = lastMark(snap.timeline).settleMs;
  const b = snap.rival ? lastMark(snap.rival).settleMs : a;
  const gap = Math.round(b - a);
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);
  const landed = snap.take.events[1];
  const version = useRef(0);
  const rivalSpec = snap.rivalSpec;
  useMemo(() => {
    version.current += 1;
  }, [rivalSpec]);

  return (
    <div className="race">
      <section className="group">
        <header>
          <h2>Race the same take</h2>
        </header>
        <div className="seg" role="group" aria-label={`Spring for ${go} on side B`}>
          {FEELS.map((item) => (
            <button key={item.name} type="button" className="control" aria-pressed={item.name === choice.feel} onClick={() => onChoice({ ...choice, feel: item.name })}>
              {item.name}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={`What ${back} does on side B`}>
          {RULES.map((item) => (
            <button key={item.policy} type="button" className="control" aria-pressed={item.policy === choice.policy} onClick={() => onChoice({ ...choice, policy: item.policy })}>
              {item.short}
            </button>
          ))}
        </div>
      </section>
      <div className="lane" id="rival" inert>
        {rivalSpec ? <Follower key={version.current} spec={rivalSpec} showcase={showcase} session={session} take={snap.take} props={props} /> : null}
      </div>
      <dl className="score">
        <div data-side="a">
          <dt><i />A</dt>
          <dd>{feelOf(ours) ?? `${ours.stiffness} / ${ours.damping}`}, {OUTCOME[policyOf(snap.spec, showcase)]}</dd>
          <dd className="num" id="settle-a">{settles(a)}</dd>
        </div>
        <div data-side="b">
          <dt><i />B</dt>
          <dd>{choice.feel}, {OUTCOME[choice.policy]}</dd>
          <dd className="num" id="settle-b">{settles(b)}</dd>
        </div>
      </dl>
      <p className="note" id="race-note">
        Both get {go} at 0 ms{landed ? ` and ${back} at ${Math.round(landed.atMs - origin)} ms` : ''}.{' '}
        {gap === 0 ? 'They come to rest together.' : `B comes to rest ${Math.abs(gap)} ms ${gap > 0 ? 'later' : 'sooner'}.`}
      </p>
    </div>
  );
}
