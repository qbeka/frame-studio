import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MotionSpec } from '../../runtime/spec';
import type { ChannelName } from '../../runtime/channel';
import { inspectChannel, sampleTimeline, type Timeline } from '../../runtime/timeline';
import type { Take } from '../../authoring/project';
import type { ProjectStore } from './store';
import { takeRange, usePlayhead, type Session } from './session';
import { Ribbon, type Marker } from './Ribbon';

const CHANNELS: ChannelName[] = ['height', 'width', 'y', 'x', 'opacity', 'scale'];
const FRAME_MS = 1000 / 60;

/** The target and channel that travel furthest in pixels, which is what a first look should show. */
function busiest(timeline: Timeline, targetIds: string[], start: number, end: number): { target: string; channel: ChannelName } | null {
  let best: { target: string; channel: ChannelName } | null = null;
  let most = 1;
  const samples = Array.from({ length: 25 }, (_, i) => sampleTimeline(timeline, start + ((end - start) * i) / 24));
  for (const target of targetIds) {
    // A translated target snaps its size, so only its position can travel.
    const sized = timeline.spec.targets[target]!.bounds !== 'translate';
    for (const channel of sized ? (['height', 'width', 'y', 'x'] as const) : (['y', 'x'] as const)) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const sample of samples) {
        const drawn = sample.targets[target]!;
        // A target that is not drawn has no place yet, and its first box would read as a leap.
        if (!drawn.inFlow && !drawn.exiting) continue;
        min = Math.min(min, drawn[channel]);
        max = Math.max(max, drawn[channel]);
      }
      // Strictly more, so the first declared target wins a tie and the ribbon stays predictable.
      if (max - min > most + 0.5) {
        most = max - min;
        best = { target, channel };
      }
    }
  }
  return best;
}

function format(value: number) {
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3);
}

function unitOf(channel: ChannelName) {
  return channel === 'opacity' || channel === 'scale' ? '' : ' px';
}

function Readout({ session, target, channel }: { session: Session; target: string; channel: ChannelName }) {
  const t = usePlayhead(session);
  const timeline = session.timeline();
  if (!timeline) return null;
  const reading = inspectChannel(timeline, target, channel, t);
  const unit = unitOf(channel);
  const carries = reading.segment.curve?.type === 'spring';
  return (
    <dl className="readout">
      <div><dt>Position</dt><dd>{format(reading.position)}{unit}</dd></div>
      <div>
        <dt>Velocity</dt>
        <dd title={carries ? undefined : 'A timed curve or a jump does not carry speed into what follows.'}>
          {format(reading.velocity)}{unit}/s{carries ? '' : ' (not carried)'}
        </dd>
      </div>
      <div><dt>Target</dt><dd>{format(reading.target)}{unit}</dd></div>
    </dl>
  );
}

export function Transport({ spec, take, session, store, canLoadExample }: { spec: MotionSpec; take: Take | null; session: Session; store: ProjectStore; canLoadExample: boolean }) {
  const t = usePlayhead(session);
  const targetIds = Object.keys(spec.targets);
  const [target, setTarget] = useState(targetIds[0]!);
  const [channel, setChannel] = useState<ChannelName>('height');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [injectCommand, setInjectCommand] = useState(spec.commands[0] ?? '');
  const [resetState, setResetState] = useState(spec.initialState);
  const timeline = session.timeline();
  const live = session.mode === 'live';
  const hasTake = take !== null && take.events.some((e) => e.type === 'command');
  const range = take && timeline ? takeRange(take, timeline, live ? t : 0) : { start: 0, end: 1 };

  // Until someone chooses, the ribbon follows whatever moves most in the take on screen.
  const chosen = useRef(false);
  const takeStart = take?.startMs ?? null;
  useEffect(() => {
    if (chosen.current || !hasTake || !timeline || live) return;
    const pick = busiest(timeline, targetIds, range.start, range.end);
    if (!pick) return;
    setTarget(pick.target);
    setChannel(pick.channel);
  }, [takeStart, hasTake, live, timeline === null]);

  const markers: Marker[] = useMemo(() => {
    if (!take) return [];
    const list: Marker[] = [];
    take.events.forEach((event, index) => {
      if (event.type !== 'command') return;
      const step = session.steps.find((s) => s.atMs === event.atMs && s.command === event.command);
      list.push({ index, event, outcome: step?.outcome ?? null });
    });
    return list;
  }, [take, session.steps, session.replayed]);

  const ghostMarker = activeIndex !== null ? markers.find((m) => m.index === activeIndex) : markers[markers.length - 1];
  const ghost = useMemo(() => {
    // The first command is what starts the take, so the ghost needs one after it to remove.
    if (live || !take || !ghostMarker || markers.length < 2) return null;
    return session.ghost(take, spec, ghostMarker.index);
  }, [take, ghostMarker?.index, spec, markers.length, live]);

  function moveMarker(index: number, atMs: number) {
    if (!take) return;
    const before = markers.filter((m) => m.index < index).pop()?.event.atMs ?? range.start;
    const after = markers.find((m) => m.index > index)?.event.atMs ?? range.end;
    const clamped = Math.min(after - 1, Math.max(before + 1, atMs));
    const events = take.events.map((event, i) => (i === index ? { ...event, atMs: clamped } : event));
    const next = { ...take, events: [...events].sort((a, b) => a.atMs - b.atMs) };
    store.setTake(next, `marker.${index}`);
    session.inspectAt(next, spec, clamped);
  }

  function inject() {
    if (!take) return;
    const event = { atMs: t, type: 'command' as const, command: injectCommand };
    const next = { ...take, events: [...take.events, event].sort((a, b) => a.atMs - b.atMs) };
    store.setTake(next);
    session.inspectAt(next, spec, t);
    setActiveIndex(next.events.indexOf(event));
  }

  function removeMarker() {
    if (!take || activeIndex === null) return;
    const next = { ...take, events: take.events.filter((_, i) => i !== activeIndex) };
    setActiveIndex(null);
    store.setTake(next);
    session.inspectAt(next, spec, t);
  }

  function seekTo(next: number) {
    const clamped = Math.max(range.start, Math.min(range.end, next));
    if (live) {
      session.pause();
      return;
    }
    session.seek(clamped);
  }

  function stepKeys(event: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: event.shiftKey ? 1 : FRAME_MS,
      ArrowUp: event.shiftKey ? 1 : FRAME_MS,
      ArrowLeft: event.shiftKey ? -1 : -FRAME_MS,
      ArrowDown: event.shiftKey ? -1 : -FRAME_MS,
      PageUp: 100,
      PageDown: -100,
    };
    const move = moves[event.key];
    if (move !== undefined) seekTo(t + move);
    else if (event.key === 'Home') seekTo(range.start);
    else if (event.key === 'End') seekTo(range.end);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (element.closest('input,textarea,select,[contenteditable],dialog')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === ' ' && !element.closest('button') && hasTake) {
        event.preventDefault();
        if (session.mode === 'playing') session.pause();
        else if (live) session.pause();
        else session.play();
      } else if (event.key === 'r') {
        session.resetTo(resetState);
      } else if (event.key === 'i' && !live) {
        inject();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const atMs = Math.round(t - range.start);
  const stateNow = timeline ? session.controller.getState() : spec.initialState;
  const label = `${atMs} milliseconds, state ${spec.states[stateNow]?.label ?? stateNow}`;

  return (
    <section className="ui transport" aria-label="Transport">
      <div className="transport-row">
        <button
          type="button"
          className="button"
          disabled={!hasTake}
          onClick={() => (session.mode === 'inspect' ? session.play() : session.pause())}
        >
          {session.mode === 'inspect' ? 'Play' : 'Pause'}
        </button>
        <span className="time mono" aria-live="off">{hasTake ? `${atMs} ms` : 'No take'}</span>
        <span className="mode">{live ? 'Live' : session.mode === 'playing' ? 'Playing back' : 'Inspecting'}</span>
        <div className="grow" />
        <select aria-label="Ribbon target" value={target} onChange={(e) => { chosen.current = true; setTarget(e.target.value); }}>
            {targetIds.map((id) => <option key={id}>{id}</option>)}
          </select>
        <select aria-label="Ribbon channel" value={channel} onChange={(e) => { chosen.current = true; setChannel(e.target.value as ChannelName); }}>
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        {hasTake ? <Readout session={session} target={target} channel={channel} /> : null}
      </div>

      {hasTake && timeline ? (
        <Ribbon
          timeline={timeline}
          ghost={ghost}
          target={target}
          channel={channel}
          start={range.start}
          end={range.end}
          playhead={t}
          markers={markers}
          activeMarker={activeIndex}
          onSeek={seekTo}
          onSeekEnd={() => {}}
          onMoveMarker={moveMarker}
          onPickMarker={setActiveIndex}
          stepKeys={stepKeys}
          label={label}
          ghostLabel={ghostMarker ? `without this ${ghostMarker.event.command}` : null}
        />
      ) : (
        <div className="ribbon-empty">
          <p className="lede">Use the component. Press its first control, then interrupt it before it settles.</p>
          <p className="hint">Frame records what you do as named commands, with the measured layout at each one.</p>
          {canLoadExample ? (
            <button type="button" className="link" onClick={session.loadExample}>Or play an example of an interrupted open</button>
          ) : null}
        </div>
      )}

      {!live && hasTake ? (
        <div className="transport-row transport-inspect">
          <p className="hint">The component is paused here. Choose how to go back to it.</p>
          <button type="button" className="button" onClick={session.continueFromHere}>Continue from here</button>
          <select aria-label="Reset to state" value={resetState} onChange={(e) => setResetState(e.target.value)}>
              {Object.entries(spec.states).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
            </select>
          <button type="button" className="button" onClick={() => session.resetTo(resetState)}>Reset to this state</button>
          <div className="grow" />
          <select aria-label="Command to inject" value={injectCommand} onChange={(e) => setInjectCommand(e.target.value)}>
              {spec.commands.map((c) => <option key={c}>{c}</option>)}
            </select>
          <button type="button" className="button" onClick={inject}>Interrupt here</button>
          {activeIndex !== null ? (
            <button type="button" className="link" onClick={removeMarker}>Remove marker</button>
          ) : null}
        </div>
      ) : null}
      {session.warnings.length > 0 ? <p className="warning" role="status">{session.warnings[session.warnings.length - 1]}</p> : null}
    </section>
  );
}
