import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PropValue } from '../../packages/studio/authoring/registration';
import { measureTargets } from '../../packages/studio/runtime/dom';
import { useFrameController, type FrameHandle } from '../../packages/studio/runtime/react';
import type { MotionSpec, SpringCurve } from '../../packages/studio/runtime/spec';
import { lastMark } from '../../packages/studio/runtime/timeline';
import { ExportSheet } from './ExportSheet';
import { Follower } from './Follower';
import { attachHand } from './hand';
import { Help } from './Help';
import { LIBRARY } from './library';
import { curveOf, feelOf, label, policyOf, withCurve } from './motion';
import { Plate, PlateThumb } from './Plate';
import { Plot, Velocity } from './Plot';
import { CopyButton, RaceControls, Tune, announce, rivalOf, type RaceChoice } from './Rail';
import { LEAD_MS, createSession, type Geometry, type Preview, type Session, type Snapshot, type TakeItem } from './session';
import { SHOWCASES, type Showcase } from './showcase';
import { publishStage } from './stageStore';
import { edgeAt, levelsOf } from './trace';
import { defaultTake, fromLibrary, readLink, writeLink, type Link, type TakeSource } from './urlState';
import { describe } from './words';

type Mode = 'tune' | 'race' | 'export' | null;
type Layout = 'wide' | 'mid' | 'narrow';
type Props = Record<string, PropValue>;

/** Where the trace starts, in pixels from the left of the stage. The stylesheet agrees. */
const PLOT_LEFT = 392;
const LANE_PAD = 32;
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
    grab: () => false,
    drag: noop,
    release: noop,
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

/** The bar a hand takes hold of. It rides the followed edge, wherever the take has put it. */
function GrabBar({ session, snap, showcase, left, top, barRef }: { session: Session; snap: Snapshot; showcase: Showcase; left: number; top: number; barRef: React.RefObject<HTMLDivElement | null> }) {
  const { timeline, levels, state } = snap;
  const usable = state === showcase.from || state === showcase.to;
  const from = showcase.registration.states[showcase.from]!.label;
  const to = showcase.registration.states[showcase.to]!.label;
  useEffect(() => {
    const bar = barRef.current!;
    const draw = (t: number) => {
      const edge = edgeAt(timeline, showcase, t, levels).position;
      const width = showcase.width;
      bar.style.transform = `translate(${(left + width / 2).toFixed(1)}px, ${(top + edge).toFixed(1)}px)`;
      const progress = levels.high === levels.low ? 0 : (edge - levels.low) / (levels.high - levels.low);
      const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
      bar.setAttribute('aria-valuenow', String(percent));
      bar.setAttribute('aria-valuetext', percent === 0 ? from : percent === 100 ? to : `${percent} percent of the way to ${to}`);
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, timeline, levels, showcase, left, top, barRef, from, to]);
  return (
    <div
      ref={barRef}
      className="grab"
      id="grab"
      role="slider"
      tabIndex={0}
      hidden={!usable}
      aria-label={`${showcase.name}, by hand`}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
    >
      <i />
    </div>
  );
}

/** The takes as a contact strip: each one printed small, under the motion as it stands. */
function Strip({ session, snap, showcase, own, onOwn, onSave }: { session: Session; snap: Snapshot; showcase: Showcase; own: TakeSource | null; onOwn: () => void; onSave: () => Promise<boolean> }) {
  const { spec, levels, geometry, take } = snap;
  // The small prints are worked out one to a task, after whatever was pressed has been answered.
  const [previews, setPreviews] = useState(() => new Map<string, Preview | null>());
  useEffect(() => {
    let live = true;
    let timer = 0;
    const next = new Map<string, Preview | null>();
    const one = (index: number) => {
      if (!live) return;
      const item = LIBRARY[index];
      if (!item) {
        setPreviews(next);
        return;
      }
      next.set(item.id, session.preview(fromLibrary(showcase, item)));
      timer = window.setTimeout(() => one(index + 1));
    };
    timer = window.setTimeout(() => one(0), 30);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The geometry and the spec are what a preview is worked out from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, showcase, spec, levels, geometry]);
  const [mine, setMine] = useState<Preview | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setMine(own ? session.preview(own) : null), 30);
    return () => clearTimeout(timer);
  }, [session, own, spec, levels, geometry]);
  const yours = take.name === null;
  const [saved, setSaved] = useState<'idle' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    if (saved === 'idle') return undefined;
    const id = setTimeout(() => setSaved('idle'), 1600);
    return () => clearTimeout(id);
  }, [saved]);

  return (
    <div className="strip" role="group" aria-label="Takes">
      <div className="frames">
        {LIBRARY.map((item) => (
          <button
            key={item.id}
            type="button"
            className="frame"
            data-take={item.id}
            title={item.about}
            aria-pressed={take.name === item.id}
            onClick={() => session.loadTake(fromLibrary(showcase, item), true)}
          >
            <PlateThumb preview={previews.get(item.id) ?? null} showcase={showcase} levels={levels} />
            <span>{item.name}</span>
          </button>
        ))}
        <button type="button" className="frame" data-take="yours" title="The last take you made on this component" aria-pressed={yours} aria-disabled={!own || undefined} onClick={() => { if (own && !yours) onOwn(); }}>
          <PlateThumb preview={mine} showcase={showcase} levels={levels} />
          <span>Yours</span>
        </button>
      </div>
      <button
        type="button"
        className="control outline swap"
        id="save-plate"
        aria-label="Save this take as an image"
        onClick={async () => {
          const done = await onSave();
          setSaved(done ? 'saved' : 'failed');
        }}
      >
        <span className={saved === 'idle' ? 'on' : ''}>Save plate</span>
        <span className={saved === 'saved' ? 'on' : ''}>Saved</span>
        <span className={saved === 'failed' ? 'on' : ''}>Blocked</span>
      </button>
    </div>
  );
}

const OUTCOME = { retarget: 'reverses', queue: 'finishes first', ignore: 'ignores it' } as const;

function Stage({ showcase, start, onPick }: { showcase: Showcase; start: Link; onPick: (id: string) => void }) {
  const session = useMemo(() => createSession(showcase, { spec: start.spec, take: start.take }), [showcase, start]);
  const snap = useSyncExternalStore(session.subscribe, session.get);
  const [mode, setMode] = useState<Mode>(null);
  const [props, setPropsState] = useState<Props>(() => defaultProps(showcase));
  const [layout, setLayout] = useState<Layout>('wide');
  const [place, setPlace] = useState({ left: 0, top: 0 });
  const [reserve, setReserve] = useState(0);
  const [stillNote, setStillNote] = useState(false);
  const [help, setHelp] = useState(false);
  const [own, setOwn] = useState<TakeSource | null>(() => (start.take.name === null ? start.take : null));
  const [choice, setChoice] = useState<RaceChoice>(() => ({
    feel: feelOf(curveOf(start.spec, showcase, 'go')) === 'Lively' ? 'Soft' : 'Lively',
    policy: policyOf(start.spec, showcase),
  }));
  const demo = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
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
    void document.fonts?.ready.then(() => session.introduce(canvas.current!, 700));
    return () => session.dismissIntro();
  }, [session]);

  // Ambient motion only runs while the stage is on screen.
  useEffect(() => {
    const element = demo.current!;
    const observer = new IntersectionObserver(([entry]) => element.toggleAttribute('data-onscreen', entry!.isIntersecting), { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The grab bar only exists once the layout is known, so the hand is attached then.
  const ready = snap !== null;
  // Whether a hand is on is written straight to the stage. It changes on a pointer move, which is no time to render the whole stage again.
  useEffect(() => (ready ? attachHand({ session, showcase, live: live.current!, bar: bar.current!, onHold: (held) => demo.current?.toggleAttribute('data-hand', held) }) : undefined), [session, showcase, ready]);

  const rivalSpec = useMemo(() => (mode === 'race' && snap ? rivalOf(snap.spec, showcase, choice) : null), [mode, snap?.spec, showcase, choice]);
  // In a task of its own, after the press that asked for it has been answered and painted.
  useEffect(() => {
    const id = setTimeout(() => {
      session.setRival(rivalSpec);
      if (rivalSpec) session.replayFromStart(canvas.current!);
    });
    return () => clearTimeout(id);
  }, [session, rivalSpec]);

  // What a tool opens, its panel or its second copy of the component, mounts a frame after the
  // tool does, for the same reason.
  const [lane, setLane] = useState<Mode>(null);
  useEffect(() => {
    if (mode === null) {
      setLane(null);
      return undefined;
    }
    let timer = 0;
    const frame = requestAnimationFrame(() => (timer = window.setTimeout(() => setLane(mode))));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [mode]);

  // The strip of takes is drawn once the stage itself is up.
  const [stripReady, setStripReady] = useState(false);
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => setStripReady(true), 60);
    return () => clearTimeout(timer);
  }, [ready]);

  // The figures further down the page draw from whatever the stage is showing.
  useEffect(() => {
    if (snap) publishStage({ showcase, spec: snap.spec, geometry: snap.geometry, levels: snap.levels });
  }, [showcase, snap?.spec, snap?.geometry, snap?.levels]);

  // The visitor's own take is kept, so choosing an example does not lose it.
  const settledTake = snap && !snap.moving && !snap.held && snap.take.name === null && snap.take.events.length > 0 ? snap.take : null;
  useEffect(() => {
    if (!settledTake) return;
    const first = settledTake.events[0]!.atMs;
    const events: TakeItem[] = settledTake.events.map((event) => ({ ...event, atMs: event.atMs - first }));
    setOwn({ initialState: settledTake.initialState, scripted: false, name: null, build: () => events });
  }, [settledTake]);

  const status = !snap ? '' : stillNote ? 'Reduced motion is on, so Replay shows the end of the take and you can drag along the curve to step through it' : describe(snap, showcase);
  useEffect(() => announce(status), [status]);
  useEffect(() => setStillNote(false), [snap?.take]);

  // The address always holds what is on screen, so the page can be shared as it stands.
  const spec = snap?.spec;
  const take = snap?.take;
  const busy = snap ? snap.held || (snap.moving && snap.phase === 'live') : true;
  const link = useMemo(() => (spec && take ? writeLink(showcase, spec, take) : null), [showcase, spec, take]);
  useEffect(() => {
    if (!link || busy) return undefined;
    const id = setTimeout(() => {
      const next = `${location.pathname}${link.query}${location.hash}`;
      if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
    }, 150);
    return () => clearTimeout(id);
  }, [link, busy]);

  const changeSpec = useCallback((next: MotionSpec, replay: boolean) => session.setSpec(next, replay, canvas.current), [session]);
  const changeSpring = useCallback(
    (curve: SpringCurve) => {
      const now = session.get();
      if (now) session.setSpec(withCurve(now.spec, showcase, 'go', curve), false, canvas.current);
    },
    [session, showcase],
  );
  const exportReady = useCallback(() => session.replayFromStart(canvas.current!), [session]);
  const [exported, setExported] = useState<MotionSpec | null>(null);

  const savePlate = useCallback(async () => {
    const now = session.get();
    if (!now) return false;
    const { savePrint } = await import('./print');
    const done = await savePrint(now, showcase, `${location.origin}${location.pathname}${writeLink(showcase, now.spec, now.take).query}`);
    announce(done ? 'Saved the plate as an image' : 'Saving was blocked by the browser');
    return done;
  }, [session, showcase]);

  // ?capture lets the script that draws the share card ask the page for its own art.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('capture')) return undefined;
    const hook = window as unknown as { __frameArt?: (width: number, height: number, unit: number) => Promise<string | null> };
    hook.__frameArt = async (width, height, unit) => {
      const now = session.get();
      if (!now) return null;
      const { drawArt } = await import('./print');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      drawArt(canvas.getContext('2d')!, now, showcase, { x: unit * 2, y: unit * 2, width: width - unit * 4, height: height - unit * 4 }, unit);
      return canvas.toDataURL('image/png');
    };
    return () => void delete hook.__frameArt;
  }, [session, showcase]);

  // Shortcuts work from anywhere on the page except a field, and never with a modifier held.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable=""], [role=slider], [role=menu]')) return;
      const k = event.key.toLowerCase();
      if (event.key === '?') setHelp((now) => !now);
      else if (event.key === 'Escape' && help) setHelp(false);
      else if (event.key === 'Escape' && mode) {
        if (canvas.current!.contains(target)) return;
        const id = mode;
        setMode(null);
        document.getElementById(id)?.focus();
      } else if (help) return;
      else if (k === 'r') session.toggle(canvas.current!);
      else if (k === 's') session.setSlow(!session.get()?.slow);
      else if (k === 't') setMode((now) => (now === 'tune' ? null : 'tune'));
      else if (k === 'a') setMode((now) => (now === 'race' ? null : 'race'));
      else if (k === 'e') setMode((now) => (now === 'export' ? null : 'export'));
      else if (k === 'p') void savePlate();
      else if (k >= '1' && k <= String(LIBRARY.length) && !target.closest('.sc')) session.loadTake(fromLibrary(showcase, LIBRARY[Number(k) - 1]!), true);
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [session, showcase, mode, help, savePlate]);

  const state = snap?.state;
  const playing = snap?.phase === 'playing';
  const attached = layout !== 'narrow';
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);
  const second = mode === 'race' ? rivalSpec : mode === 'export' ? exported : null;
  const laneWidth = showcase.width + LANE_PAD;
  const beside = layout === 'wide' && (mode === 'race' || mode === 'export');
  const plotLeft = PLOT_LEFT + (beside ? laneWidth : 0);
  const origin = snap ? snap.domain.start + LEAD_MS : 0;
  const restA = snap ? lastMark(snap.timeline).settleMs : 0;
  const restB = snap?.rival ? lastMark(snap.rival).settleMs : restA;
  const gap = Math.round(restB - restA);
  const ours = snap ? curveOf(snap.spec, showcase, 'go') : null;
  const toggleMode = (next: Exclude<Mode, null>) => setMode((now) => (now === next ? null : next));

  return (
    <div
      className="demo"
      ref={demo}
      data-layout={layout}
      data-component={showcase.id}
      data-mode={mode ?? undefined}
      data-rest={snap && snap.phase === 'paused' ? '' : undefined}
      style={{ '--reserve': `${reserve}px`, '--component-width': `${showcase.width}px`, '--lane-width': `${laneWidth}px`, '--plot-left': `${plotLeft}px` } as React.CSSProperties}
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
      <div className="modes" role="group" aria-label="Tools">
        <button type="button" className="control" id="tune" aria-pressed={mode === 'tune'} aria-expanded={mode === 'tune'} onClick={() => toggleMode('tune')}>Tune</button>
        <button type="button" className="control" id="race" aria-pressed={mode === 'race'} aria-expanded={mode === 'race'} onClick={() => toggleMode('race')}>Race</button>
        <button type="button" className="control" id="export" aria-pressed={mode === 'export'} aria-expanded={mode === 'export'} onClick={() => toggleMode('export')}>Export</button>
        <button type="button" className="control keys" id="keys" aria-label="Keyboard shortcuts" aria-expanded={help} onClick={() => setHelp((now) => !now)}>?</button>
      </div>

      <div className="scope">
        <div className="canvas" ref={canvas}>
          {snap ? <Plate session={session} snap={snap} showcase={showcase} left={place.left} top={place.top} /> : null}
          <div className="live" ref={live}>
            <Panel session={session} showcase={showcase} props={props} setProps={setProps} />
          </div>
          {snap ? <GrabBar session={session} snap={snap} showcase={showcase} left={place.left} top={place.top} barRef={bar} /> : null}
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
        {mode === 'race' || mode === 'export' ? (
          <div className="lane" id={mode === 'race' ? 'rival' : 'exported'} inert>
            <span className="lane-name">{mode === 'race' ? 'Side B' : 'The exported files'}</span>
            {snap && second && lane === mode ? <Follower key={`${mode}-${JSON.stringify(second.transitions)}`} spec={second} showcase={showcase} session={session} take={snap.take} props={props} /> : null}
          </div>
        ) : null}
        {snap ? (
          <Plot session={session} snap={snap} showcase={showcase} attached={attached} originY={place.top} reach={attached ? plotLeft - place.left - showcase.width : 0} onSpring={changeSpring} />
        ) : (
          <div className="plot" />
        )}
        <div className="band">
          {snap ? <Readouts session={session} snap={snap} showcase={showcase} /> : <dl className="readouts" />}
          {snap && mode === 'race' ? <RaceControls showcase={showcase} choice={choice} onChoice={setChoice} /> : null}
          {snap ? <Velocity session={session} snap={snap} showcase={showcase} /> : <div className="velocity" />}
        </div>
      </div>

      {mode === 'tune' || mode === 'export' ? (
        <div className="rail" role="group" aria-label={mode === 'tune' ? 'Motion settings' : 'Export'}>
          {!snap || lane !== mode ? null : mode === 'tune' ? (
            <Tune snap={snap} showcase={showcase} onChange={changeSpec} />
          ) : (
            <ExportSheet snap={snap} session={session} showcase={showcase} stage={demo} onReady={exportReady} onSpec={setExported} />
          )}
        </div>
      ) : null}

      {snap && stripReady ? <Strip session={session} snap={snap} showcase={showcase} own={own} onOwn={() => own && session.loadTake(own, true)} onSave={savePlate} /> : <div className="strip" />}

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
        {mode === 'race' && snap && ours ? (
          <p id="take-note" className="race-note">
            <span data-side="a"><i />A, {feelOf(ours) ?? `${ours.stiffness} / ${ours.damping}`}, {OUTCOME[policyOf(snap.spec, showcase)]}, rests at <b id="settle-a">{Math.max(0, Math.round(restA - origin))} ms</b></span>
            <span data-side="b"><i />B, {choice.feel}, {OUTCOME[choice.policy]}, rests at <b id="settle-b">{Math.max(0, Math.round(restB - origin))} ms</b></span>
            <span id="race-note">{gap === 0 ? 'They come to rest together' : `B comes to rest ${Math.abs(gap)} ms ${gap > 0 ? 'later' : 'sooner'}`}</span>
          </p>
        ) : (
          <p id="take-note">{status}</p>
        )}
        <CopyButton
          text={() => `${location.origin}${location.pathname}${link?.query ?? ''}`}
          name={link && !link.held ? 'Copy a link to this motion, without the take, which is too long for a link' : 'Copy a link to this motion and this take'}
          className="control outline"
        >
          Copy link
        </CopyButton>
      </div>
      {help ? <Help onClose={() => setHelp(false)} go={go} back={back} /> : null}
    </div>
  );
}

export function Demo() {
  const first = useMemo(() => readLink(location.search), []);
  const [link, setLink] = useState(first);
  const pick = useCallback((id: string) => {
    const showcase = SHOWCASES.find((item) => item.id === id)!;
    setLink((now) => (now.showcase === showcase ? now : { showcase, spec: showcase.spec, take: defaultTake(showcase) }));
  }, []);
  return <Stage key={link.showcase.id} showcase={link.showcase} start={link} onPick={pick} />;
}
