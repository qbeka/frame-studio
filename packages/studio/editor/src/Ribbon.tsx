import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { inspectChannel, type Timeline } from '../../runtime/timeline';
import type { ChannelName } from '../../runtime/channel';
import type { TakeEvent } from '../../runtime/timeline';

const HEIGHT = 132;
const PAD = { top: 18, bottom: 34 };
/** Time before the first command in a take's range. See takeRange. */
const LEAD_MS = 60;
const SAMPLES = 280;

export interface Marker {
  index: number;
  event: Extract<TakeEvent, { type: 'command' }>;
  outcome: string | null;
}

function pathFor(timeline: Timeline, target: string, channel: ChannelName, start: number, end: number) {
  const values: number[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    values.push(inspectChannel(timeline, target, channel, start + ((end - start) * i) / SAMPLES).position);
  }
  return values;
}

/**
 * The take ribbon. The solid line is what the selected channel did. The dotted line is what it
 * would have done without the interruption you last touched. Dragging a marker moves that
 * command in time, and the component and both lines follow.
 */
export function Ribbon({
  timeline,
  ghost,
  target,
  channel,
  start,
  end,
  playhead,
  markers,
  activeMarker,
  onSeek,
  onSeekEnd,
  onMoveMarker,
  onPickMarker,
  stepKeys,
  label,
  ghostLabel,
}: {
  timeline: Timeline;
  ghost: Timeline | null;
  target: string;
  channel: ChannelName;
  start: number;
  end: number;
  playhead: number;
  markers: Marker[];
  activeMarker: number | null;
  onSeek: (t: number) => void;
  onSeekEnd: () => void;
  onMoveMarker: (index: number, t: number) => void;
  onPickMarker: (index: number) => void;
  stepKeys: (event: KeyboardEvent) => void;
  label: string;
  ghostLabel: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const measure = useRef<ResizeObserver | null>(null);
  const attach = (element: HTMLDivElement | null) => {
    box.current = element;
    measure.current?.disconnect();
    if (!element) return;
    setWidth(element.clientWidth);
    measure.current = new ResizeObserver(() => setWidth(element.clientWidth));
    measure.current.observe(element);
  };

  const span = Math.max(1, end - start);
  const x = (t: number) => ((t - start) / span) * width;
  const timeAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    return start + (Math.max(0, Math.min(rect.width, clientX - rect.left)) / rect.width) * span;
  };

  const { solid, dotted, y } = useMemo(() => {
    const values = pathFor(timeline, target, channel, start, end);
    const other = ghost ? pathFor(ghost, target, channel, start, end) : null;
    const all = other ? values.concat(other) : values;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const range = max - min || 1;
    const toY = (v: number) => PAD.top + (1 - (v - min) / range) * (HEIGHT - PAD.top - PAD.bottom);
    const draw = (list: number[]) =>
      list.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / SAMPLES) * width).toFixed(1)} ${toY(v).toFixed(1)}`).join('');
    return { solid: draw(values), dotted: other ? draw(other) : null, y: toY };
  }, [timeline, ghost, target, channel, start, end, width]);

  const dragging = useRef<number | 'playhead' | null>(null);

  function pointerDown(event: PointerEvent, what: number | 'playhead') {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = what;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    if (what === 'playhead') onSeek(timeAt(event.clientX));
    else onPickMarker(what);
  }

  function pointerMove(event: PointerEvent) {
    if (dragging.current === null) return;
    if (dragging.current === 'playhead') onSeek(timeAt(event.clientX));
    else onMoveMarker(dragging.current, timeAt(event.clientX));
  }

  function pointerUp() {
    if (dragging.current === 'playhead') onSeekEnd();
    dragging.current = null;
  }

  const here = inspectChannel(timeline, target, channel, playhead).position;
  const every = width < 520 ? 400 : width < 900 ? 200 : 100;
  const ticks: number[] = [];
  for (let t = 0; t <= span - LEAD_MS; t += every) ticks.push(t);
  const floor = HEIGHT - 18;

  return (
    <div className="ribbon" ref={attach} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <svg width={width} height={HEIGHT} className="ribbon-svg" aria-hidden="true" onPointerDown={(e) => pointerDown(e, 'playhead')}>
        <line x1={0} x2={width} y1={floor} y2={floor} className="ribbon-axis" />
        {ticks.map((t) => (
          <g key={t} transform={`translate(${x(start + LEAD_MS + t).toFixed(1)} 0)`}>
            <line y1={floor} y2={floor + 4} className="ribbon-axis" />
            <text y={HEIGHT - 4} className="ribbon-tick" textAnchor={t === 0 ? 'start' : 'middle'}>{t === 0 ? '0 ms' : t}</text>
          </g>
        ))}
        {dotted ? <path d={dotted} className="ribbon-ghost" /> : null}
        <path d={solid} className="ribbon-path" />
        <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={floor} className="ribbon-playhead" />
        <circle cx={x(playhead)} cy={y(here)} r={3.5} className="ribbon-dot" />
      </svg>
      <div
        className="ribbon-slider"
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(playhead - start)}
        aria-valuetext={label}
        onKeyDown={stepKeys}
      />
      {dotted && ghostLabel ? <p className="ribbon-legend">Dotted: {ghostLabel}</p> : null}
      {markers.map((marker) => (
        <button
          type="button"
          key={marker.index}
          className="marker"
          data-active={marker.index === activeMarker || undefined}
          data-outcome={marker.outcome ?? undefined}
          style={{ left: x(marker.event.atMs) }}
          aria-label={`${marker.event.command} at ${Math.round(marker.event.atMs - start)} ms, moved with the arrow keys`}
          onPointerDown={(e) => pointerDown(e, marker.index)}
          onFocus={() => onPickMarker(marker.index)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'ArrowLeft') onMoveMarker(marker.index, marker.event.atMs - step);
            else if (event.key === 'ArrowRight') onMoveMarker(marker.index, marker.event.atMs + step);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span>{marker.event.command}</span>
        </button>
      ))}
    </div>
  );
}
