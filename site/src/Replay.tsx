import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Inspector, initialInspectorProps } from '@frame-studio/fixture-inspector';
import authored from '../../fixtures/inspector/inspector.frame.json';
import { createController, type FrameController } from '../../packages/studio/runtime/controller';
import { measureTargets } from '../../packages/studio/runtime/dom';
import { useFrameController, type FrameHandle } from '../../packages/studio/runtime/react';
import type { InterruptionRule, MotionSpec, Rects } from '../../packages/studio/runtime/spec';
import { inspectChannel, lastMark, replayTake, sampleTimeline, type TakeEvent, type Timeline } from '../../packages/studio/runtime/timeline';

type Policy = InterruptionRule['policy'];
type Geometry = Record<string, Rects>;

const BASE = authored.spec as unknown as MotionSpec;
const STATES = Object.keys(BASE.states);
const OPEN_AT = 60;
const DELAY_MIN = 40;
const DELAY_MAX = 320;
const CHART_HEIGHT = 132;
const CHART_PAD = 22;
const SAMPLES = 240;

const RULES: { policy: Policy; label: string; note: string }[] = [
  { policy: 'retarget', label: 'Reverse from here', note: 'Cancel takes over at once, from the current height and speed.' },
  { policy: 'queue', label: 'Finish first', note: 'The panel finishes opening, then Cancel runs.' },
  { policy: 'ignore', label: 'Ignore it', note: 'Cancel is dropped and the panel stays open.' },
];

/** The authored spec with one thing changed: what Cancel does while the panel is opening. */
function specFor(policy: Policy): MotionSpec {
  return {
    ...BASE,
    transitions: BASE.transitions.map((transition) => {
      if (transition.id !== 'open') return transition;
      const interruptions = transition.interruptions.map((rule) => (rule.command === 'cancel' ? { ...rule, policy } : rule));
      return { ...transition, interruptions };
    }),
  };
}

function replay(spec: MotionSpec, geometry: Geometry, delay: number | null) {
  const events: TakeEvent[] = [{ atMs: OPEN_AT, type: 'command', command: 'open' }];
  if (delay !== null) events.push({ atMs: OPEN_AT + delay, type: 'command', command: 'cancel' });
  return replayTake(spec, 0, geometry[spec.initialState]!, events, (state) => geometry[state]!).timeline;
}

function heights(timeline: Timeline, end: number) {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => inspectChannel(timeline, 'surface', 'height', (end * i) / SAMPLES).position);
}

function line(values: number[], x: (i: number) => number, y: (v: number) => number) {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
}

/** The hairline behind the page: the surface height from the default take. */
function drawRidge(values: number[]) {
  const svg = document.getElementById('ridge');
  const path = svg?.querySelector('path');
  if (!svg || !path) return;
  const width = innerWidth;
  const height = innerHeight;
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  path.setAttribute(
    'd',
    line(values, (i) => (i / SAMPLES) * width, (v) => height * (0.94 - 0.26 * ((v - min) / range))),
  );
}

/** The same component with no motion applied, measured once per state for the replay's layout. */
function Probe({ state, onMount }: { state: string; onMount: (state: string, root: HTMLElement | null, elements: Map<string, HTMLElement>) => void }) {
  const elements = useRef(new Map<string, HTMLElement>());
  const frame: FrameHandle = {
    state,
    send() {},
    remeasure() {},
    root: () => ({ ref: (element) => onMount(state, element, elements.current), 'data-frame-root': '' }),
    target(id) {
      const present = BASE.states[state]?.targets[id]?.present !== false;
      return {
        ref: (element) => {
          if (element) elements.current.set(id, element);
          else elements.current.delete(id);
        },
        'data-frame-target': id,
        ...(BASE.targets[id]?.bounds === 'surface' ? { 'data-frame-surface': '' as const } : {}),
        ...(present ? {} : { hidden: true }),
      };
    },
  };
  return <Inspector frame={frame} props={initialInspectorProps} setProps={noop} />;
}

function noop() {}

const Stage = memo(function Stage({ controller }: { controller: FrameController }) {
  const frame = useFrameController(controller, BASE);
  return <Inspector frame={frame} props={initialInspectorProps} setProps={noop} />;
});

function Chart({
  timeline,
  ghost,
  end,
  t,
  delay,
  onSeek,
  onDelay,
}: {
  timeline: Timeline;
  ghost: Timeline;
  end: number;
  t: number;
  delay: number;
  onSeek: (t: number) => void;
  onDelay: (delay: number) => void;
}) {
  const box = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const dragging = useRef<'time' | 'marker' | null>(null);

  useLayoutEffect(() => {
    const element = box.current!;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const x = (time: number) => (time / end) * width;
  const { solid, dotted } = useMemo(() => {
    const values = heights(timeline, end);
    const other = heights(ghost, end);
    const all = values.concat(other);
    const min = Math.min(...all);
    const range = Math.max(...all) - min || 1;
    const y = (v: number) => CHART_PAD + (1 - (v - min) / range) * (CHART_HEIGHT - CHART_PAD * 2);
    const at = (i: number) => (i / SAMPLES) * width;
    return { solid: line(values, at, y), dotted: line(other, at, y) };
  }, [timeline, ghost, end, width]);

  const timeAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    return (Math.max(0, Math.min(rect.width, clientX - rect.left)) / rect.width) * end;
  };
  const clamp = (value: number) => Math.round(Math.max(DELAY_MIN, Math.min(DELAY_MAX, value)));

  function start(event: PointerEvent, what: 'time' | 'marker') {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = what;
    box.current!.setPointerCapture(event.pointerId);
    if (what === 'time') onSeek(timeAt(event.clientX));
  }
  function move(event: PointerEvent) {
    if (dragging.current === 'time') onSeek(timeAt(event.clientX));
    if (dragging.current === 'marker') onDelay(clamp(timeAt(event.clientX) - OPEN_AT));
  }
  function key(event: KeyboardEvent) {
    const next = { ArrowLeft: delay - 5, ArrowDown: delay - 5, ArrowRight: delay + 5, ArrowUp: delay + 5, Home: DELAY_MIN, End: DELAY_MAX }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onDelay(clamp(next));
  }

  const marker = x(OPEN_AT + delay);
  return (
    <svg
      ref={box}
      className="chart"
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      aria-label="Surface height over time. The solid line is what happened, and the dotted line is the path with no interruption."
      role="group"
      onPointerDown={(event) => start(event, 'time')}
      onPointerMove={move}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      <path className="ghost-line" d={dotted} />
      <path className="take-line" d={solid} />
      <line className="playhead" x1={x(t)} x2={x(t)} y1={0} y2={CHART_HEIGHT} />
      <g
        className="marker"
        role="slider"
        tabIndex={0}
        aria-label="When Cancel lands, after opening starts"
        aria-valuemin={DELAY_MIN}
        aria-valuemax={DELAY_MAX}
        aria-valuenow={delay}
        aria-valuetext={`${delay} ms`}
        onPointerDown={(event) => start(event, 'marker')}
        onKeyDown={key}
      >
        <rect x={marker - 22} y={0} width={44} height={CHART_HEIGHT} fill="transparent" />
        <line x1={marker} x2={marker} y1={14} y2={CHART_HEIGHT} />
        <circle cx={marker} cy={10} r={6} />
      </g>
    </svg>
  );
}

export function Replay() {
  const [policy, setPolicy] = useState<Policy>('retarget');
  const [delay, setDelay] = useState(150);
  const [t, setT] = useState(OPEN_AT + 120);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(true);
  const controller = useMemo(() => createController(BASE, { history: true, reducedMotion: false }), []);
  const probes = useRef(new Map<string, { root: HTMLElement; elements: Map<string, HTMLElement> }>());
  const stage = useRef<HTMLDivElement>(null);
  const time = useRef(t);
  time.current = t;
  const speed = useRef(0.25);
  speed.current = slow ? 0.25 : 1;

  const mountProbe = useCallback((state: string, root: HTMLElement | null, elements: Map<string, HTMLElement>) => {
    if (root) probes.current.set(state, { root, elements });
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const next: Geometry = {};
      for (const state of STATES) {
        const probe = probes.current.get(state)!;
        next[state] = measureTargets(probe.root, probe.elements, (id) => BASE.states[state]?.targets[id]?.present === true);
      }
      setGeometry(next);
    };
    measure();
    void document.fonts?.ready.then(measure);
    let width = stage.current!.clientWidth;
    const observer = new ResizeObserver(() => {
      if (stage.current!.clientWidth === width) return;
      width = stage.current!.clientWidth;
      measure();
    });
    observer.observe(stage.current!);
    return () => observer.disconnect();
  }, []);

  const spec = useMemo(() => specFor(policy), [policy]);
  const take = useMemo(() => (geometry ? replay(spec, geometry, delay) : null), [spec, geometry, delay]);
  const ghost = useMemo(() => (geometry ? replay(spec, geometry, null) : null), [spec, geometry]);
  const end = useMemo(() => {
    if (!geometry) return 1;
    const settled = RULES.map(({ policy: rule }) => lastMark(replay(specFor(rule), geometry, DELAY_MAX)).settleMs);
    return Math.ceil(Math.max(...settled) / 20) * 20 + 40;
  }, [geometry]);

  useEffect(() => {
    if (!geometry) return;
    const values = heights(replay(specFor('retarget'), geometry, 150), end);
    drawRidge(values);
    const redraw = () => drawRidge(values);
    addEventListener('resize', redraw);
    return () => removeEventListener('resize', redraw);
  }, [geometry, end]);

  useEffect(() => {
    if (!take) return;
    controller.setSpec(spec);
    controller.load(take, time.current);
  }, [controller, spec, take]);

  useEffect(() => {
    if (take) controller.seek(t);
  }, [controller, take, t]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = requestAnimationFrame(function step(now) {
      const next = Math.min(end, time.current + (now - last) * speed.current);
      last = now;
      setT(next);
      if (next >= end) setPlaying(false);
      else id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, end]);

  const seek = useCallback((next: number) => {
    setPlaying(false);
    setT(next);
  }, []);

  const toggle = useCallback(() => {
    setPlaying((now) => {
      if (!now && time.current >= end - 1) setT(0);
      return !now;
    });
  }, [end]);

  useEffect(() => {
    const hero = document.getElementById('hero-play');
    const run = () => {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('replay')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
      setT(0);
      setPlaying(true);
    };
    hero?.addEventListener('click', run);
    return () => hero?.removeEventListener('click', run);
  }, []);

  const rule = RULES.find((item) => item.policy === policy)!;
  const reading = take ? inspectChannel(take, 'surface', 'height', t) : null;
  const settled = take ? lastMark(take).settleMs : 0;
  const stageHeight = geometry ? Math.max(...STATES.map((state) => geometry[state]!.surface!.height)) : 0;
  const stateName = take && sampleTimeline(take, t).state === 'editing' ? 'Editing' : 'Compact';

  return (
    <>
      <div className="scenes" role="group" aria-label="What Cancel does while the panel is opening">
        {RULES.map((item) => (
          <button key={item.policy} className="pill ghost small" type="button" aria-pressed={item.policy === policy} onClick={() => setPolicy(item.policy)}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="note rule-note" id="rule-note">{rule.note}</p>
      <div className="card">
        <div className="stage" ref={stage} style={{ minHeight: stageHeight + 48 }}>
          <div className="stage-live" inert>
            <Stage controller={controller} />
          </div>
          <div className="stage-probe" aria-hidden="true" inert>
            {STATES.map((state) => (
              <Probe key={state} state={state} onMount={mountProbe} />
            ))}
          </div>
        </div>
        {take && ghost ? <Chart timeline={take} ghost={ghost} end={end} t={t} delay={delay} onSeek={seek} onDelay={setDelay} /> : null}
        <div className="legend">
          <span><i className="swatch" />What happened</span>
          <span><i className="swatch dotted" />With no interruption</span>
          <span className="drag-hint">Drag the marker to move Cancel</span>
        </div>
        <div className="player">
          <button className="pill dark small" id="play" type="button" onClick={toggle}>{playing ? 'Pause' : 'Play'}</button>
          <input
            id="time"
            type="range"
            min={0}
            max={end}
            step={1}
            value={Math.min(t, end)}
            aria-label="Time in the replay, in milliseconds"
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="clock" id="clock">{Math.round(t)} ms</span>
          <button className="pill ghost small" id="speed" type="button" aria-pressed={!slow} onClick={() => setSlow((now) => !now)}>
            {slow ? 'Quarter speed' : 'Real speed'}
          </button>
        </div>
        <div className="who">
          <div className="person"><span className="name">State</span><b id="read-state">{stateName}</b></div>
          <div className="person"><span className="name">Surface height</span><b id="read-height">{reading ? reading.position.toFixed(1) : '0.0'} px</b></div>
          <div className="person"><span className="name">Speed</span><b id="read-velocity">{reading ? Math.round(reading.velocity) : 0} px/s</b></div>
          <div className="person"><span className="name">Settles at</span><b id="read-settle">{Math.round(settled)} ms</b></div>
        </div>
      </div>
    </>
  );
}
