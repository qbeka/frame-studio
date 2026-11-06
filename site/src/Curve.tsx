import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { inspectChannel, type Timeline } from '../../packages/studio/runtime/timeline';
import { LEAD_MS, type Session, type Snapshot } from './session';

const PLOT_HEIGHT = 104;
const TOP = 8;
const BOTTOM = 20;
const SAMPLES = 280;
const CAPITAL = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function sample(timeline: Timeline, start: number, end: number) {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => inspectChannel(timeline, 'surface', 'height', start + ((end - start) * i) / SAMPLES).position);
}

/** The height of the panel over time. One line traces the take as it happens. */
export const Curve = memo(function Curve({ session, snap, low, high }: { session: Session; snap: Snapshot; low: number; high: number }) {
  const plot = useRef<HTMLDivElement>(null);
  const reveal = useRef<SVGRectElement>(null);
  const head = useRef<SVGGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const seekHandle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { domain, timeline, ghost, take, steps, marker } = snap;
  const span = domain.end - domain.start;

  useLayoutEffect(() => {
    const element = plot.current!;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const paths = useMemo(() => {
    const values = sample(timeline, domain.start, domain.end);
    const other = ghost ? sample(ghost, domain.start, domain.end) : null;
    const all = other ? values.concat(other) : values;
    const margin = (high - low) * 0.06;
    const min = Math.min(low - margin, ...all);
    const max = Math.max(high + margin, ...all);
    const y = (value: number) => TOP + (1 - (value - min) / (max - min)) * (PLOT_HEIGHT - TOP - BOTTOM);
    const line = (list: number[]) => list.map((value, i) => `${i === 0 ? 'M' : 'L'}${((i / SAMPLES) * width).toFixed(1)} ${y(value).toFixed(1)}`).join('');
    return { solid: line(values), dotted: other ? line(other) : null, y };
  }, [timeline, ghost, domain, width, low, high]);

  const x = (t: number) => ((t - domain.start) / span) * width;
  const timeAt = (clientX: number) => {
    const box = plot.current!.getBoundingClientRect();
    return domain.start + (Math.max(0, Math.min(box.width, clientX - box.left)) / box.width) * span;
  };

  useEffect(() => {
    const draw = (t: number) => {
      const at = Math.max(0, Math.min(width, ((t - domain.start) / span) * width));
      reveal.current!.setAttribute('width', at.toFixed(1));
      head.current!.setAttribute('transform', `translate(${at.toFixed(1)} 0)`);
      dot.current!.setAttribute('cy', paths.y(inspectChannel(timeline, 'surface', 'height', t).position).toFixed(1));
      const label = `${Math.max(0, Math.round(t - domain.start - LEAD_MS))} ms`;
      seekHandle.current!.setAttribute('aria-valuenow', String(Math.round(t - domain.start)));
      seekHandle.current!.setAttribute('aria-valuetext', label);
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, timeline, domain, span, width, paths]);

  const dragging = useRef<number | 'seek' | null>(null);

  function press(event: PointerEvent, what: number | 'seek') {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging.current = what;
    if (what === 'seek') session.seek(timeAt(event.clientX));
    else session.beginDrag(what);
  }
  function move(event: PointerEvent) {
    if (dragging.current === 'seek') session.seek(timeAt(event.clientX));
    else if (dragging.current !== null) session.moveMarker(dragging.current, timeAt(event.clientX));
  }
  function release() {
    if (typeof dragging.current === 'number') session.endDrag();
    dragging.current = null;
  }

  function seekKey(event: KeyboardEvent) {
    const stepMs = event.shiftKey ? 50 : 10;
    const now = session.time();
    const next = { ArrowLeft: now - stepMs, ArrowDown: now - stepMs, ArrowRight: now + stepMs, ArrowUp: now + stepMs, Home: domain.start, End: snap.takeEnd }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    session.seek(next);
  }
  function markerKey(event: KeyboardEvent, index: number, atMs: number) {
    const stepMs = event.shiftKey ? 25 : 5;
    const next = { ArrowLeft: atMs - stepMs, ArrowDown: atMs - stepMs, ArrowRight: atMs + stepMs, ArrowUp: atMs + stepMs, Home: 0, End: domain.end }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    session.moveMarker(index, next);
  }

  const origin = domain.start + LEAD_MS;
  const stepEvery = width < 520 ? 400 : 200;
  const ticks: number[] = [];
  for (let t = 0; t <= span - LEAD_MS; t += stepEvery) ticks.push(t);
  const first = take.events[0];

  return (
    <div className="plot" ref={plot} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
      <svg width={width} height={PLOT_HEIGHT} aria-hidden="true">
        <defs>
          <clipPath id="curve-reveal">
            <rect ref={reveal} x={0} y={0} width={0} height={PLOT_HEIGHT} />
          </clipPath>
        </defs>
        <line className="level" x1={0} x2={width} y1={paths.y(high)} y2={paths.y(high)} />
        <line className="level" x1={0} x2={width} y1={paths.y(low)} y2={paths.y(low)} />
        <text className="level-name" x={width} y={paths.y(high) - 4}>Editing</text>
        <text className="level-name" x={width} y={paths.y(low) - 4}>Compact</text>
        {ticks.map((t) => (
          <g key={t} transform={`translate(${x(origin + t).toFixed(1)} 0)`}>
            <line className="tick" y1={PLOT_HEIGHT - BOTTOM} y2={PLOT_HEIGHT - BOTTOM + 4} />
            <text className="tick-label" y={PLOT_HEIGHT - 4} textAnchor="middle">{t === 0 ? '0 ms' : t}</text>
          </g>
        ))}
        {paths.dotted ? <path className="line-ghost" d={paths.dotted} /> : null}
        <path className="line-ahead" d={paths.solid} />
        <path className="line-take" d={paths.solid} clipPath="url(#curve-reveal)" />
        <g ref={head}>
          <line className="playhead" x1={0} x2={0} y1={0} y2={PLOT_HEIGHT - BOTTOM} />
          <circle ref={dot} className="playhead-dot" cx={0} cy={0} r={3.5} />
        </g>
      </svg>

      <div
        ref={seekHandle}
        className="seek"
        role="slider"
        tabIndex={0}
        aria-label="Time in the take"
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={0}
        onKeyDown={seekKey}
        onPointerDown={(event) => press(event, 'seek')}
      />

      {first ? <span className="first" style={{ left: x(first.atMs) }}>{CAPITAL(first.command)}</span> : null}

      {take.events.slice(1).map((event, i) => {
        const index = i + 1;
        const outcome = steps.find((item) => item.atMs === event.atMs && item.command === event.command)?.outcome;
        const ms = Math.round(event.atMs - origin);
        return (
          <div
            key={index}
            className="marker"
            role="slider"
            tabIndex={0}
            data-active={index === marker || undefined}
            data-outcome={outcome}
            data-flip={x(event.atMs) > width - 96 || undefined}
            style={{ left: x(event.atMs) }}
            aria-label={`When ${CAPITAL(event.command)} lands, after ${CAPITAL(first!.command)}`}
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={ms}
            aria-valuetext={`${ms} ms`}
            onKeyDown={(keyEvent) => markerKey(keyEvent, index, event.atMs)}
            onPointerDown={(pointerEvent) => press(pointerEvent, index)}
          >
            <i />
            <span>{CAPITAL(event.command)} {ms} ms</span>
          </div>
        );
      })}
    </div>
  );
});
