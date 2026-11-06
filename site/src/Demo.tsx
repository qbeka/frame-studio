import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Inspector, initialInspectorProps, type InspectorProps } from '@frame-studio/fixture-inspector';
import { measureTargets } from '../../packages/studio/runtime/dom';
import { useFrameController, type FrameHandle } from '../../packages/studio/runtime/react';
import type { MotionSpec } from '../../packages/studio/runtime/spec';
import { isAnimating } from '../../packages/studio/runtime/timeline';
import { Curve } from './Curve';
import { ExportSheet } from './ExportSheet';
import { BASE, STATES } from './motion';
import { Inspect, TryIt } from './Rail';
import { LEAD_MS, createSession, type Geometry, type Session, type Snapshot } from './session';

type Mode = 'try' | 'inspect';

const LONGEST_ERROR = 'Enter an amount above zero, such as 18.40.';
const noop = () => {};

/** The same component with no motion applied, measured once per state for replays and sizing. */
function Probe({ state, props, onMount }: { state: string; props: InspectorProps; onMount: (root: HTMLElement | null, elements: Map<string, HTMLElement>) => void }) {
  const elements = useRef(new Map<string, HTMLElement>());
  const frame: FrameHandle = {
    state,
    send: noop,
    remeasure: noop,
    root: () => ({ ref: (element) => onMount(element, elements.current), 'data-frame-root': '' }),
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
  return <Inspector frame={frame} props={props} setProps={noop} />;
}

const Panel = memo(function Panel({ session, props, setProps }: { session: Session; props: InspectorProps; setProps: (patch: Partial<InspectorProps>) => void }) {
  const base = useFrameController(session.controller, BASE);
  return <Inspector frame={{ ...base, send: session.send }} props={props} setProps={setProps} />;
});

const NAMES: Record<string, string> = { open: 'Open', cancel: 'Cancel', submit: 'Save', back: 'Keep editing', done: 'Done' };

function describe(snap: Snapshot): string {
  const { take, steps, ghost, phase, moving } = snap;
  const origin = snap.domain.start + LEAD_MS;
  if (take.scripted) return `This is an example take, with Cancel landing ${Math.round(steps[1]!.atMs - origin)} ms into Open.`;
  // A queued command adds a step when it finally runs. This describes the press itself.
  const pressed = take.events[take.events.length - 1];
  const last = steps.find((step) => step.atMs === pressed?.atMs && step.command === pressed?.command);
  if (take.events.length > 1 && last) {
    const name = NAMES[last.command] ?? last.command;
    const ms = Math.round(last.atMs - origin);
    if (last.outcome === 'queue') return `${name} landed ${ms} ms in and waited for the motion to finish.`;
    if (last.outcome === 'ignore') return `${name} landed ${ms} ms in and was ignored.`;
    if (last.outcome === 'reject') return `${name} landed ${ms} ms in and had nothing to do.`;
    if (ghost && isAnimating(ghost, last.atMs)) return `${name} landed ${ms} ms in and took over from the current height and speed.`;
    return `${name} landed ${ms} ms in, after the motion had settled.`;
  }
  if (last?.command === 'open') {
    if (moving && phase === 'live') return 'Open is running, so press Cancel before it settles.';
    return 'Open ran to the end, so press Cancel sooner or turn on Slow motion.';
  }
  if (last?.command === 'cancel') return 'Cancel landed after Open had settled, so there was nothing to interrupt.';
  return 'This take ran without an interruption.';
}

/** Time, height and speed under the playhead. Written directly, once a frame. */
function Readouts({ session, snap }: { session: Session; snap: Snapshot }) {
  const height = useRef<HTMLElement>(null);
  const speed = useRef<HTMLElement>(null);
  useEffect(() => {
    const draw = (t: number) => {
      const reading = session.reading(t);
      height.current!.textContent = `${reading.position.toFixed(1)} px`;
      speed.current!.textContent = `${Math.round(reading.velocity).toLocaleString('en-US')} px/s`;
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, snap.timeline]);
  const settles = Math.round(snap.takeEnd - 60 - (snap.domain.start + LEAD_MS));
  return (
    <dl className="readouts">
      <div><dt>State</dt><dd id="read-state">{BASE.states[snap.state]?.label}</dd></div>
      <div><dt>Height</dt><dd id="read-height" ref={height as React.RefObject<HTMLElement>} /></div>
      <div><dt>Speed</dt><dd id="read-speed" ref={speed as React.RefObject<HTMLElement>} /></div>
      <div><dt>Settles</dt><dd id="read-settle">{settles} ms</dd></div>
    </dl>
  );
}

/** Both panels' real drawn height while Export is open. */
function Compare({ session, stage }: { session: Session; stage: React.RefObject<HTMLElement | null> }) {
  const ours = useRef<HTMLElement>(null);
  const theirs = useRef<HTMLElement>(null);
  useEffect(() => {
    const draw = () => {
      const a = stage.current?.querySelector('.canvas .live [data-frame-target=surface]');
      const b = stage.current?.querySelector('#exported [data-frame-target=surface]');
      const exported = b?.getBoundingClientRect().height ?? 0;
      if (a && ours.current) ours.current.textContent = `${a.getBoundingClientRect().height.toFixed(1)} px`;
      if (!theirs.current) return;
      theirs.current.textContent = `${exported.toFixed(1)} px`;
      theirs.current.parentElement!.hidden = exported === 0;
    };
    draw();
    // After every frame listener, so the preview has already moved to this moment.
    return session.onFrame(() => queueMicrotask(draw));
  }, [session, stage]);
  return (
    <dl className="readouts">
      <div><dt>This page</dt><dd id="height-ours" ref={ours as React.RefObject<HTMLElement>} /></div>
      <div><dt>Exported</dt><dd id="height-exported" ref={theirs as React.RefObject<HTMLElement>} /></div>
    </dl>
  );
}

function Clock({ session, origin }: { session: Session; origin: number }) {
  const text = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const draw = (t: number) => {
      text.current!.textContent = `${Math.max(0, Math.round(t - origin))} ms`;
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, origin]);
  return <output className="clock" id="clock" ref={text} aria-label="Time in the take" />;
}

export function Demo() {
  const session = useMemo(createSession, []);
  const snap = useSyncExternalStore(session.subscribe, session.get);
  const [mode, setMode] = useState<Mode>('try');
  const [exporting, setExporting] = useState(false);
  const [props, setPropsState] = useState<InspectorProps>(initialInspectorProps);
  const [levels, setLevels] = useState({ low: 0, high: 0, max: 0 });
  const [stillNote, setStillNote] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const probes = useRef(new Map<string, { root: HTMLElement; elements: Map<string, HTMLElement> }>());

  useLayoutEffect(() => {
    stage.current = canvas.current!.closest('.stage');
  }, []);

  const setProps = useCallback((patch: Partial<InspectorProps>) => setPropsState((current) => ({ ...current, ...patch })), []);
  const mounts = useMemo(() => {
    const entry = (key: string) => (root: HTMLElement | null, elements: Map<string, HTMLElement>) => {
      if (root) probes.current.set(key, { root, elements });
    };
    return Object.fromEntries([...STATES, 'tallest'].map((key) => [key, entry(key)]));
  }, []);

  const measure = useCallback(() => {
    const next: Geometry = {};
    for (const state of STATES) {
      const probe = probes.current.get(state)!;
      next[state] = measureTargets(probe.root, probe.elements, (id) => BASE.states[state]?.targets[id]?.present === true);
    }
    const tall = probes.current.get('tallest')!;
    const tallest = measureTargets(tall.root, tall.elements, (id) => BASE.states.editing?.targets[id]?.present === true);
    session.setGeometry(next);
    setLevels({ low: next.compact!.surface!.height, high: next.editing!.surface!.height, max: Math.ceil(tallest.surface!.height) });
  }, [session]);

  useLayoutEffect(measure, [measure, props]);

  useLayoutEffect(() => {
    const element = canvas.current!;
    void document.fonts?.ready.then(measure);
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    void document.fonts?.ready.then(() => session.introduce(canvas.current!, 500));
  }, [session]);

  useEffect(() => {
    if (!exporting) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || canvas.current!.contains(event.target as Node)) return;
      setExporting(false);
      exportButton.current!.focus();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [exporting]);

  const status = !snap ? '' : stillNote ? 'Reduced motion is on, so Replay shows the end of the take and you can drag along the curve to step through it.' : describe(snap);
  useEffect(() => {
    const element = document.getElementById('status');
    if (element) element.textContent = status;
  }, [status]);

  const changeSpec = useCallback(
    (spec: MotionSpec, replay: boolean) => session.setSpec(spec, replay, canvas.current),
    [session],
  );
  useEffect(() => setStillNote(false), [snap?.take]);
  const closeExport = useCallback(() => {
    setExporting(false);
    exportButton.current?.focus();
  }, []);
  const exportReady = useCallback(() => {
    session.replayFromStart(canvas.current!);
  }, [session]);

  const state = snap?.state;
  const playing = snap?.phase === 'playing';
  const origin = snap ? snap.domain.start + LEAD_MS : 0;

  return (
    <div
      className="demo"
      style={{ '--panel-max': `${levels.max}px`, '--panel-open': `${levels.high}px` } as React.CSSProperties}
      onPointerDownCapture={() => session.dismissIntro()}
      onKeyDownCapture={() => session.dismissIntro()}
    >
      <div className="canvas" ref={canvas}>
        <div className="destination" aria-hidden="true" />
        <div className="live">
          <Panel session={session} props={props} setProps={setProps} />
        </div>
        <div className="probes" aria-hidden="true" inert>
          {STATES.map((item) => (
            <Probe key={item} state={item} props={props} onMount={mounts[item]!} />
          ))}
          <Probe state="editing" props={{ ...props, error: LONGEST_ERROR }} onMount={mounts.tallest!} />
        </div>
      </div>

      <div className="rail" role="group" aria-label="Motion settings">
        {exporting && snap ? (
          <ExportSheet snap={snap} session={session} props={props} onClose={closeExport} onReady={exportReady} />
        ) : (
          <>
            <div className="modes" role="group" aria-label="Mode">
              <button type="button" className="control" aria-pressed={mode === 'try'} onClick={() => setMode('try')}>Try it</button>
              <button type="button" className="control" aria-pressed={mode === 'inspect'} onClick={() => setMode('inspect')}>Inspect</button>
            </div>
            {snap ? (mode === 'try' ? <TryIt snap={snap} onChange={changeSpec} /> : <Inspect snap={snap} session={session} onChange={changeSpec} />) : null}
          </>
        )}
      </div>

      <div className="transport" role="group" aria-label="Actions">
        <button type="button" className="control" id="open" aria-disabled={state !== 'compact' || undefined} onClick={() => { if (state === 'compact') session.send('open'); }}>Open</button>
        <button type="button" className="control" id="cancel" aria-disabled={state !== 'editing' || undefined} onClick={() => { if (state === 'editing') session.send('cancel'); }}>Cancel</button>
        <span className="divider" />
        <button
          type="button"
          className="control swap"
          id="replay"
          onClick={() => {
            setStillNote(matchMedia('(prefers-reduced-motion: reduce)').matches);
            session.toggle(canvas.current!);
          }}
        >
          <span className={playing ? '' : 'on'}>Replay</span>
          <span className={playing ? 'on' : ''}>Pause</span>
        </button>
        <button type="button" className="control" id="slow" aria-pressed={snap?.slow ?? false} onClick={() => session.setSlow(!snap?.slow)}>Slow motion</button>
        <span className="spacer" />
        <Clock session={session} origin={origin} />
        <button ref={exportButton} type="button" className="control outline" id="export" aria-pressed={exporting} onClick={() => setExporting((now) => !now)}>Export</button>
      </div>

      <div className="curve">
        <div className="caption">
          <p id="take-note">{status}</p>
          {exporting ? (
            <Compare session={session} stage={stage} />
          ) : mode === 'inspect' && snap ? (
            <Readouts session={session} snap={snap} />
          ) : (
            <p className="legend">
              <span><i className="swatch" />What happened</span>
              <span><i className="swatch dotted" />With no interruption</span>
            </p>
          )}
        </div>
        {snap ? <Curve session={session} snap={snap} low={levels.low} high={levels.high} /> : <div className="plot" />}
      </div>
    </div>
  );
}
