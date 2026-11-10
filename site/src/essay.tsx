import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { springAt } from '../../packages/studio/runtime/spring';
import { lastMark, replayTake } from '../../packages/studio/runtime/timeline';
import { readLinear, springToLinear } from './linearEasing';
import { RULES, curveOf, label, withPolicy, type Policy } from './motion';
import { drawArt, type ArtSource } from './print';
import { LEAD_MS, TAIL_MS, type TakeItem } from './session';
import { readStage, subscribeStage, type StageView } from './stageStore';
import { edgeAt } from './trace';

/**
 * The two figures in the essay that are worked out live. Both read what the stage is showing, so
 * they are about the component and the springs on screen, and tuning the stage redraws them.
 */
const ratio = () => Math.min(2, window.devicePixelRatio || 1);
const px = (value: number) => `${Math.round(Math.abs(value)).toLocaleString('en-US')} px/s`;

function useStage(): StageView | null {
  return useSyncExternalStore(subscribeStage, readStage);
}

/** One press and the press that undoes it, `delayMs` later, under one rule. */
function reversal(stage: StageView, policy: Policy, delayMs: number) {
  const { showcase, geometry } = stage;
  const spec = { ...withPolicy(stage.spec, showcase, policy), initialState: showcase.spec.initialState };
  const events: TakeItem[] = [
    { atMs: LEAD_MS, type: 'command', command: showcase.go },
    { atMs: LEAD_MS + delayMs, type: 'command', command: showcase.back },
  ];
  const { timeline, steps } = replayTake(spec, 0, geometry[spec.initialState]!, events, (state) => geometry[state]!);
  return { timeline, steps, events };
}

function Delay({ stage, delay, onDelay, id }: { stage: StageView; delay: number; onDelay: (ms: number) => void; id: string }) {
  const go = label(stage.showcase, stage.showcase.go);
  const back = label(stage.showcase, stage.showcase.back);
  const min = 20;
  const max = 400;
  return (
    <label className="range figure-range" htmlFor={id}>
      <span>{back} lands</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={5}
        value={delay}
        style={{ '--fill': `${((delay - min) / (max - min)) * 100}%` } as React.CSSProperties}
        aria-valuetext={`${delay} ms into ${go}`}
        onChange={(event) => onDelay(Number(event.target.value))}
      />
      <output>{delay} ms into {go}</output>
    </label>
  );
}

function RulePlate({ stage, source, order }: { stage: StageView; source: ArtSource; order: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current!;
    if (width === 0) return undefined;
    // Each plate is printed in a task of its own, a moment after the one before it.
    const timer = setTimeout(() => {
      const scale = ratio();
      element.width = Math.round(width * scale);
      element.height = Math.round(element.clientHeight * scale);
      const ctx = element.getContext('2d')!;
      drawArt(ctx, source, stage.showcase, { x: 10 * scale, y: 8 * scale, width: element.width - 20 * scale, height: element.height - 16 * scale }, scale * 0.75, 0.42);
    }, order * 12);
    return () => clearTimeout(timer);
  }, [stage, source, width, order]);
  return <canvas ref={canvas} aria-hidden="true" />;
}

function Rules({ stage, delay, onDelay }: { stage: StageView; delay: number; onDelay: (ms: number) => void }) {
  const { showcase, levels } = stage;
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);
  const runs = useMemo(() => RULES.map((rule) => ({ rule, ...reversal(stage, rule.policy, delay) })), [stage, delay]);
  // One time axis for all three, so the plates can be compared side by side.
  const end = Math.ceil((Math.max(...runs.map((run) => lastMark(run.timeline).settleMs)) + TAIL_MS) / 100) * 100;
  const domain = { start: 0, end: Math.max(700, end) };
  const cut = LEAD_MS + delay;
  return (
    <>
      <div className="rules">
        {runs.map(({ rule, timeline, steps, events }, order) => {
          const source: ArtSource = { timeline, ghost: null, levels, domain, hands: [], take: { startMs: 0, initialState: showcase.spec.initialState, events, scripted: true, name: null }, marker: null, takeEnd: lastMark(timeline).settleMs + TAIL_MS };
          const speed = edgeAt(timeline, showcase, cut, levels).velocity;
          const later = steps.find((step, i) => i > 1 && step.command === showcase.back);
          const what =
            rule.policy === 'retarget'
              ? `${back} takes over at once and keeps ${px(speed)}`
              : rule.policy === 'queue'
                ? `${go} runs to its end, then ${back} runs${later ? ` at ${Math.round(later.atMs - LEAD_MS)} ms` : ''}`
                : `${back} is dropped, and ${go} carries on to the end`;
          return (
            <div className="rule" key={rule.policy} data-rule={rule.policy}>
              <RulePlate stage={stage} source={source} order={order} />
              <h4>{rule.label}</h4>
              <p>{what}</p>
            </div>
          );
        })}
      </div>
      <Delay stage={stage} delay={delay} onDelay={onDelay} id="rules-delay" />
    </>
  );
}

/** A path through evenly spaced moments of a function of time. */
function trace(f: (t: number) => number, from: number, to: number, x: (t: number) => number, y: (v: number) => number, n = 160) {
  let d = '';
  for (let i = 0; i <= n; i += 1) {
    const t = from + ((to - from) * i) / n;
    d += `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)} ${y(f(t)).toFixed(1)}`;
  }
  return d;
}

function Css({ stage, delay, onDelay }: { stage: StageView; delay: number; onDelay: (ms: number) => void }) {
  const { showcase, levels, spec } = stage;
  const distance = Math.max(1, Math.abs(levels.high - levels.low));
  const open = curveOf(spec, showcase, 'go');
  const turn = curveOf(spec, showcase, 'interrupt') ?? curveOf(spec, showcase, 'back');
  const easing = useMemo(() => springToLinear(open, distance, spec.settle), [open, distance, spec.settle]);
  const back = useMemo(() => springToLinear(turn, distance, spec.settle), [turn, distance, spec.settle]);
  const read = useMemo(() => readLinear(easing.css), [easing]);
  const readBack = useMemo(() => readLinear(back.css), [back]);
  const [at, setAt] = useState<number | null>(null);

  // The residual: how far the written easing sits from the spring, as a share of the distance.
  const D = easing.durationMs;
  const W = 440;
  const H = 150;
  const R = 74;
  const x = (t: number) => (t / D) * W;
  const y = (v: number) => H - 8 - v * (H - 22);
  const spring = (t: number) => springAt(open, 0, 0, 1, t / 1000).position;
  const gap = (t: number) => read(t / D) - spring(t);
  const bound = 0.002;
  const ry = (v: number) => R / 2 + 8 - (v / (bound * 1.9)) * (R / 2);
  const worst = useMemo(() => {
    let most = 0;
    for (let i = 0; i <= 600; i += 1) most = Math.max(most, Math.abs(gap((D * i) / 600)));
    return most;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [easing]);
  const shown = at ?? D * 0.3;
  const here = { spring: spring(shown), easing: read(shown / D) };

  // The reversal, by the runtime and by the CSS rule for a reversed transition.
  const run = useMemo(() => reversal(stage, 'retarget', delay), [stage, delay]);
  const cut = delay;
  const sign = Math.sign(levels.high - levels.low) || 1;
  const runtime = (t: number) => edgeAt(run.timeline, showcase, LEAD_MS + t, levels);
  const openAt = (t: number) => read(Math.min(1, t / D));
  // A reversed transition runs for a share of its time equal to how far the first one got, and its
  // easing starts again from its beginning.
  const reached = Math.max(0, Math.min(1, openAt(cut)));
  const backMs = Math.max(1, back.durationMs * reached);
  const cssPos = (t: number) => (t <= cut ? levels.low + (levels.high - levels.low) * openAt(t) : levels.low + (levels.high - levels.low) * reached * (1 - readBack(Math.min(1, (t - cut) / backMs))));
  const cssSpeed = (t: number) => (cssPos(t + 0.5) - cssPos(t - 0.5)) * 1000 * sign;
  const T = Math.max(500, Math.ceil((Math.max(lastMark(run.timeline).settleMs - LEAD_MS, cut + backMs) + 40) / 100) * 100);
  const W2 = 440;
  const x2 = (t: number) => (t / T) * W2;
  const lo = Math.min(levels.low, levels.high);
  const py = (v: number) => 10 + ((v - lo) / distance) * (H - 24) * (sign > 0 ? 1 : -1) + (sign > 0 ? 0 : H - 24);
  let peak = 300;
  let trough = 0;
  for (let i = 0; i <= 200; i += 1) {
    const t = (T * i) / 200;
    const a = runtime(t).velocity * sign;
    const b = cssSpeed(t);
    peak = Math.max(peak, a, b);
    trough = Math.min(trough, a, b);
  }
  const sy = (v: number) => 6 + ((peak - v) / (peak - trough)) * (R - 12);
  const before = runtime(cut - 0.01).velocity;

  return (
    <div className="css-figure">
      <div className="css-half">
        <h4>From rest, the easing follows the spring</h4>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The ${open.stiffness} over ${open.damping} spring from rest, and the same motion as a CSS linear easing with ${easing.stops.length} stops`}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setAt(Math.max(0, Math.min(D, ((event.clientX - box.left) / box.width) * D)));
          }}
          onPointerLeave={() => setAt(null)}
        >
          <line className="level" x1={0} x2={W} y1={y(0)} y2={y(0)} />
          <line className="level" x1={0} x2={W} y1={y(1)} y2={y(1)} />
          <path className="line-take" d={trace(spring, 0, D, x, y)} />
          <path className="css-line" d={easing.stops.map((stop, i) => `${i === 0 ? 'M' : 'L'}${x(stop.at * D).toFixed(1)} ${y(stop.value).toFixed(1)}`).join('')} />
          {easing.stops.map((stop, i) => (
            <circle key={i} className="css-stop" cx={x(stop.at * D)} cy={y(stop.value)} r={1.8} />
          ))}
          <line className="playhead" x1={x(shown)} x2={x(shown)} y1={0} y2={H} />
        </svg>
        <div className="strip-wrap">
          <svg className="residual" viewBox={`0 0 ${W} ${R}`} aria-hidden="true">
            <rect className="band" x={0} width={W} y={ry(bound)} height={ry(-bound) - ry(bound)} />
            <line className="bound" x1={0} x2={W} y1={ry(bound)} y2={ry(bound)} />
            <line className="bound" x1={0} x2={W} y1={ry(-bound)} y2={ry(-bound)} />
            <line className="level" x1={0} x2={W} y1={ry(0)} y2={ry(0)} />
            <path className="css-line solid" d={trace(gap, 0, D, x, ry, 400)} />
            <line className="playhead" x1={x(shown)} x2={x(shown)} y1={0} y2={R} />
          </svg>
          <span>The dotted lines are 0.2% of {Math.round(distance)} px, which is {(distance * bound).toFixed(2)} px</span>
        </div>
        <p className="figure-read" id="css-read">
          At <b>{Math.round(shown)} ms</b> the spring is at <b>{(here.spring * distance).toFixed(2)} px</b> and the easing at <b>{(here.easing * distance).toFixed(2)} px</b>, and the widest gap anywhere is <b>{(worst * 100).toFixed(2)}%</b>
        </p>
      </div>
      <div className="css-half">
        <h4>Turned around mid flight, only one of them keeps its speed</h4>
        <svg viewBox={`0 0 ${W2} ${H}`} role="img" aria-label={`The edge of the ${showcase.name.toLowerCase()} reversed ${delay} ms in, by the runtime and by a CSS transition with the copied easing`}>
          <line className="level" x1={0} x2={W2} y1={py(levels.low)} y2={py(levels.low)} />
          <line className="level" x1={0} x2={W2} y1={py(levels.high)} y2={py(levels.high)} />
          <line className="cut" x1={x2(cut)} x2={x2(cut)} y1={0} y2={H} />
          <path className="css-line" d={trace(cssPos, 0, T, x2, py, 300)} />
          <path className="line-take" d={trace((t) => runtime(t).position, 0, T, x2, py, 300)} />
        </svg>
        <div className="strip-wrap">
          <svg className="residual" viewBox={`0 0 ${W2} ${R}`} aria-hidden="true">
            <line className="level" x1={0} x2={W2} y1={sy(0)} y2={sy(0)} />
            <line className="cut" x1={x2(cut)} x2={x2(cut)} y1={0} y2={R} />
            <path className="css-line solid" d={trace(cssSpeed, 0, T, x2, sy, 600)} />
            <path className="line-take thin" d={trace((t) => runtime(t).velocity * sign, 0, T, x2, sy, 600)} />
          </svg>
          <span>Speed</span>
        </div>
        <p className="figure-read" id="css-turn">
          The runtime leaves the turn at <b>{px(before)}</b>, the speed it arrived with, and the transition leaves it at <b>0 px/s</b>
        </p>
        <Delay stage={stage} delay={delay} onDelay={onDelay} id="css-delay" />
      </div>
    </div>
  );
}

function Mount({ what }: { what: 'rules' | 'css' }) {
  const stage = useStage();
  const [delay, setDelay] = useSyncExternalStore(subscribeDelay, readDelay) as unknown as [number, (ms: number) => void];
  if (!stage) return null;
  return what === 'rules' ? <Rules stage={stage} delay={delay} onDelay={setDelay} /> : <Css stage={stage} delay={delay} onDelay={setDelay} />;
}

// The two figures share one moment for the interruption, so moving it in one moves it in both.
let delayNow = 110;
let delayPair: [number, (ms: number) => void] = [delayNow, setSharedDelay];
const delayListeners = new Set<() => void>();
function setSharedDelay(ms: number) {
  delayNow = ms;
  delayPair = [delayNow, setSharedDelay];
  for (const listener of delayListeners) listener();
}
function subscribeDelay(listener: () => void) {
  delayListeners.add(listener);
  return () => void delayListeners.delete(listener);
}
const readDelay = () => delayPair;

export function mountFigure(element: HTMLElement) {
  const what = element.dataset.figure;
  if (what !== 'rules' && what !== 'css') return;
  createRoot(element).render(<Mount what={what} />);
}

