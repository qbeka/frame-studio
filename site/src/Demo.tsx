import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PropValue } from '../../packages/studio/authoring/registration';
import { measureTargets } from '../../packages/studio/runtime/dom';
import { useFrameController, type FrameHandle } from '../../packages/studio/runtime/react';
import type { MotionSpec, SpringCurve } from '../../packages/studio/runtime/spec';
import { isAnimating } from '../../packages/studio/runtime/timeline';
import { ExportSheet } from './ExportSheet';
import { FEELS, curveOf, feelOf, label, policyOf, withCurve } from './motion';
import { Onion, Plot, Velocity } from './Plot';
import { CopyButton, Race, Tune, announce, rivalOf, type RaceChoice } from './Rail';
import { LEAD_MS, createSession, type Geometry, type Session, type Snapshot } from './session';
import { SHOWCASES, type Showcase } from './showcase';
import { levelsOf } from './trace';
import { readLink, writeLink, type Link } from './urlState';

type Mode = 'tune' | 'race' | 'export';
type Layout = 'wide' | 'mid' | 'narrow';
type Props = Record<string, PropValue>;

/** Where the instrument starts, in pixels from the left of the stage. The stylesheet agrees. */
const PLOT_LEFT = 392;
const noop = () => {};

function defaultProps(showcase: Showcase): Props {
  const props: Props = {};
  for (const [name, definition] of Object.entries(showcase.registration.props)) props[name] = definition.default;
  return props;
}

/** The same component with no motion applied, measured once per state for replays and sizing. */
function Probe({ showcase, state, props, onMount }: { showcase: Showcase; state: string; props: Props; onMount: (root: HTMLElement | null, elements: Map<string, HTMLElement>) => void }) {
  const elements = useRef(new Map<string, HTMLElement>());
  const { spec } = showcase;
  const frame: FrameHandle = {
    state,
    send: noop,
    remeasure: noop,
    root: () => ({ ref: (element) => onMount(element, elements.current), 'data-frame-root': '' }),
    target(id) {
      const present = spec.states[state]?.targets[id]?.present !== false;
      return {
        ref: (element) => {
          if (element) elements.current.set(id, element);
          else elements.current.delete(id);
        },
        'data-frame-target': id,
        ...(spec.targets[id]?.bounds === 'surface' ? { 'data-frame-surface': '' as const } : {}),
        ...(present ? {} : { hidden: true }),
      };
    },
  };
  return <>{showcase.registration.render({ frame, props, setProps: noop })}</>;
}

const Panel = memo(function Panel({ session, showcase, props, setProps }: { session: Session; showcase: Showcase; props: Props; setProps: (patch: Props) => void }) {
  const base = useFrameController(session.controller, showcase.spec);
  return <>{showcase.registration.render({ frame: { ...base, send: session.send }, props, setProps })}</>;
});

function describe(snap: Snapshot, showcase: Showcase): string {
  const { take, steps, ghost, phase, moving } = snap;
  const origin = snap.domain.start + LEAD_MS;
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);
  if (take.scripted && steps[1]) return `An example take, with ${back} landing ${Math.round(steps[1].atMs - origin)} ms into ${go}.`;
  // A queued command adds a step when it finally runs. This describes the press itself.
  const pressed = take.events[take.events.length - 1];
  const last = steps.find((step) => step.atMs === pressed?.atMs && step.command === pressed?.command);
  if (take.events.length > 1 && last) {
    const name = label(showcase, last.command);
    const ms = Math.round(last.atMs - origin);
    if (last.outcome === 'queue') return `${name} landed ${ms} ms in and waited for the motion to finish.`;
    if (last.outcome === 'ignore') return `${name} landed ${ms} ms in and was ignored.`;
    if (last.outcome === 'reject') return `${name} landed ${ms} ms in and had nothing to do.`;
    if (ghost && isAnimating(ghost, last.atMs)) return `${name} landed ${ms} ms in and took over from the current position and speed.`;
    return `${name} landed ${ms} ms in, after the motion had settled.`;
  }
  if (last?.command === showcase.go) {
    if (moving && phase === 'live') return `${go} is running, so press ${back} before it settles.`;
    return `${go} ran to the end, so press ${back} sooner or turn on Slow motion.`;
  }
  if (last?.command === showcase.back) return `${back} landed after ${go} had settled, so there was nothing to interrupt.`;
  return 'This take ran without an interruption.';
}

/** Time, place and speed under the playhead. Written directly, once a frame. */
function Readouts({ session, snap, showcase }: { session: Session; snap: Snapshot; showcase: Showcase }) {
  const clock = useRef<HTMLElement>(null);
  const edge = useRef<HTMLElement>(null);
  const speed = useRef<HTMLElement>(null);
  const origin = snap.domain.start + LEAD_MS;
  useEffect(() => {
    const draw = (t: number) => {
      const reading = session.reading(t);
      clock.current!.textContent = `${Math.max(0, Math.round(t - origin))} ms`;
      edge.current!.textContent = `${reading.position.toFixed(1)} px`;
      speed.current!.textContent = `${Math.round(Math.abs(reading.velocity)).toLocaleString('en-US')} px/s`;
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, snap.timeline, origin]);
  return (
    <dl className="readouts">
      <div><dt>Time</dt><dd id="clock" ref={clock as React.RefObject<HTMLElement>} /></div>
      <div><dt>{showcase.track.name}</dt><dd id="read-edge" ref={edge as React.RefObject<HTMLElement>} /></div>
      <div><dt>Speed</dt><dd id="read-speed" ref={speed as React.RefObject<HTMLElement>} /></div>
      <div><dt>State</dt><dd id="read-state">{showcase.spec.states[snap.state]?.label}</dd></div>
    </dl>
  );
}

function Stage({ showcase, start, onPick }: { showcase: Showcase; start: Link; onPick: (id: string) => void }) {
  const session = useMemo(() => createSession(showcase, { spec: start.spec, delayMs: start.delayMs }), [showcase, start]);
  const snap = useSyncExternalStore(session.subscribe, session.get);
  const [mode, setMode] = useState<Mode>('tune');
  const [props, setPropsState] = useState<Props>(() => defaultProps(showcase));
  const [layout, setLayout] = useState<Layout>('wide');
  const [place, setPlace] = useState({ left: 0, top: 0 });
  const [reserve, setReserve] = useState(0);
  const [stillNote, setStillNote] = useState(false);
  const [choice, setChoice] = useState<RaceChoice>(() => ({
    feel: feelOf(curveOf(start.spec, showcase, 'go')) === 'Lively' ? 'Soft' : 'Lively',
    policy: policyOf(start.spec, showcase),
  }));
  const demo = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const probes = useRef(new Map<string, { root: HTMLElement; elements: Map<string, HTMLElement> }>());
  const states = useMemo(() => Object.keys(showcase.spec.states), [showcase]);

  const setProps = useCallback((patch: Props) => setPropsState((current) => ({ ...current, ...patch })), []);
  const mounts = useMemo(() => {
    const entry = (key: string) => (root: HTMLElement | null, elements: Map<string, HTMLElement>) => {
      if (root) probes.current.set(key, { root, elements });
    };
    return Object.fromEntries([...states, 'tallest'].map((key) => [key, entry(key)]));
  }, [states]);

  const measure = useCallback(() => {
    const next: Geometry = {};
    let tallest = 0;
    for (const state of states) {
      const probe = probes.current.get(state)!;
      next[state] = measureTargets(probe.root, probe.elements, (id) => showcase.spec.states[state]?.targets[id]?.present === true);
      tallest = Math.max(tallest, probe.root.getBoundingClientRect().height);
    }
    const extra = probes.current.get('tallest');
    if (extra) tallest = Math.max(tallest, extra.root.getBoundingClientRect().height);
    const rootHeight = probes.current.get(showcase.from)!.root.getBoundingClientRect().height;
    session.setGeometry(next, levelsOf(showcase, next, rootHeight));
    setReserve(Math.ceil(tallest));
    const outer = canvas.current!.getBoundingClientRect();
    const root = live.current!.getBoundingClientRect();
    setPlace((now) => {
      const left = root.left - outer.left;
      const top = root.top - outer.top;
      return now.left === left && now.top === top ? now : { left, top };
    });
  }, [session, showcase, states]);

  useLayoutEffect(measure, [measure, props, layout]);

  useLayoutEffect(() => {
    const element = demo.current!;
    void document.fonts?.ready.then(measure);
    let width = -1;
    const update = () => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      setLayout(width >= 1000 ? 'wide' : width >= 640 ? 'mid' : 'narrow');
      measure();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    void document.fonts?.ready.then(() => session.introduce(canvas.current!, 500));
    return () => session.dismissIntro();
  }, [session]);

  // Ambient motion only runs while the stage is on screen.
  useEffect(() => {
    const element = demo.current!;
    const observer = new IntersectionObserver(([entry]) => element.toggleAttribute('data-onscreen', entry!.isIntersecting), { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rivalSpec = useMemo(() => (mode === 'race' && snap ? rivalOf(snap.spec, showcase, choice) : null), [mode, snap?.spec, showcase, choice]);
  useEffect(() => {
    session.setRival(rivalSpec);
    if (rivalSpec) session.replayFromStart(canvas.current!);
  }, [session, rivalSpec]);

  useEffect(() => {
    if (mode !== 'export') return undefined;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || canvas.current!.contains(event.target as Node)) return;
      setMode('tune');
      document.getElementById('export')?.focus();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [mode]);

  const status = !snap ? '' : stillNote ? 'Reduced motion is on, so Replay shows the end of the take and you can drag along the curve to step through it.' : describe(snap, showcase);
  useEffect(() => announce(status), [status]);
  useEffect(() => setStillNote(false), [snap?.take]);

  // The address always holds what is on screen, so the page can be shared as it stands.
  const spec = snap?.spec;
  const events = snap?.take.events;
  useEffect(() => {
    if (!spec || !events) return undefined;
    const delay = events[0]?.command === showcase.go && events[1]?.command === showcase.back ? events[1].atMs - events[0].atMs : null;
    const id = setTimeout(() => {
      const next = `${location.pathname}${writeLink(showcase, spec, delay)}${location.hash}`;
      if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
    }, 150);
    return () => clearTimeout(id);
  }, [showcase, spec, events]);

  const changeSpec = useCallback((next: MotionSpec, replay: boolean) => session.setSpec(next, replay, canvas.current), [session]);
  const changeSpring = useCallback(
    (curve: SpringCurve) => {
      const now = session.get();
      if (now) session.setSpec(withCurve(now.spec, showcase, 'go', curve), false, canvas.current);
    },
    [session, showcase],
  );
  const exportReady = useCallback(() => session.replayFromStart(canvas.current!), [session]);

  const state = snap?.state;
  const playing = snap?.phase === 'playing';
  const attached = layout !== 'narrow';
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);

  return (
    <div
      className="demo"
      ref={demo}
      data-layout={layout}
      data-component={showcase.id}
      data-rest={snap && snap.phase === 'paused' ? '' : undefined}
      style={{ '--reserve': `${reserve}px`, '--component-width': `${showcase.width}px` } as React.CSSProperties}
      onPointerDownCapture={() => session.dismissIntro()}
      onKeyDownCapture={() => session.dismissIntro()}
    >
      <div className="tabs" role="group" aria-label="Component">
        {SHOWCASES.map((item) => (
          <button key={item.id} type="button" className="control" aria-pressed={item === showcase} onClick={() => onPick(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      <div className="modes" role="group" aria-label="Panel">
        <button type="button" className="control" id="tune" aria-pressed={mode === 'tune'} onClick={() => setMode('tune')}>Tune</button>
        <button type="button" className="control" id="race" aria-pressed={mode === 'race'} onClick={() => setMode('race')}>Race</button>
        <button type="button" className="control" id="export" aria-pressed={mode === 'export'} onClick={() => setMode('export')}>Export</button>
      </div>

      <div className="scope">
        <div className="canvas" ref={canvas}>
          {snap ? <Onion session={session} snap={snap} showcase={showcase} left={place.left} top={place.top} /> : null}
          <div className="live" ref={live}>
            <Panel session={session} showcase={showcase} props={props} setProps={setProps} />
          </div>
          <div className="probes" aria-hidden="true" inert>
            {states.map((item) => (
              <div key={item}>
                <Probe showcase={showcase} state={item} props={props} onMount={mounts[item]!} />
              </div>
            ))}
            {showcase.tallest ? (
              <div>
                <Probe showcase={showcase} state={showcase.tallest.state} props={{ ...props, ...showcase.tallest.props }} onMount={mounts.tallest!} />
              </div>
            ) : null}
          </div>
        </div>
        {snap ? (
          <Plot session={session} snap={snap} showcase={showcase} attached={attached} originY={place.top} reach={attached ? PLOT_LEFT - place.left - showcase.width : 0} onSpring={changeSpring} />
        ) : (
          <div className="plot" />
        )}
        <div className="band">
          {snap ? <Readouts session={session} snap={snap} showcase={showcase} /> : <dl className="readouts" />}
          {snap ? <Velocity session={session} snap={snap} showcase={showcase} /> : <div className="velocity" />}
        </div>
      </div>

      <div className="rail" role="group" aria-label={mode === 'tune' ? 'Motion settings' : mode === 'race' ? 'Race' : 'Export'}>
        {!snap ? null : mode === 'tune' ? (
          <Tune snap={snap} showcase={showcase} onChange={changeSpec} />
        ) : mode === 'race' ? (
          <Race snap={snap} showcase={showcase} session={session} props={props} choice={choice} onChoice={setChoice} />
        ) : (
          <ExportSheet snap={snap} session={session} showcase={showcase} props={props} stage={demo} onReady={exportReady} />
        )}
      </div>

      <div className="transport" role="group" aria-label="Actions">
        <button type="button" className="control" id="go" aria-disabled={state !== showcase.from || undefined} onClick={() => { if (state === showcase.from) session.send(showcase.go); }}>{go}</button>
        <button type="button" className="control" id="back" aria-disabled={state !== showcase.to || undefined} onClick={() => { if (state === showcase.to) session.send(showcase.back); }}>{back}</button>
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
        <p id="take-note">{status}</p>
        <CopyButton text={() => location.href} name="Copy a link to this motion" className="control outline">Copy link</CopyButton>
      </div>
    </div>
  );
}

export function Demo() {
  const first = useMemo(() => readLink(location.search), []);
  const [link, setLink] = useState(first);
  const pick = useCallback((id: string) => {
    const showcase = SHOWCASES.find((item) => item.id === id)!;
    setLink((now) => (now.showcase === showcase ? now : { showcase, spec: showcase.spec, delayMs: showcase.exampleDelayMs }));
  }, []);
  return <Stage key={link.showcase.id} showcase={link.showcase} start={link} onPick={pick} />;
}
