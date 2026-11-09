import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { SpringCurve } from '../../packages/studio/runtime/spec';
import { springAt } from '../../packages/studio/runtime/spring';
import { lastMark, type Timeline } from '../../packages/studio/runtime/timeline';
import { DAMPING, STIFFNESS, curveOf, label, tidy } from './motion';
import { LEAD_MS, type Session, type Snapshot } from './session';
import type { Showcase } from './showcase';
import { edgeAt, extentAt } from './trace';

/** One ghost frame per 60 Hz frame. These are computed moments of the take, not measured paints. */
export const FRAME_MS = 1000 / 60;
const AXIS = 22;
/** The spring handle sits where the natural frequency times the time is this many radians. */
const HANDLE_PHASE = 1.4;

const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current!;
    const update = () => setSize((now) => (now.width === element.clientWidth && now.height === element.clientHeight ? now : { width: element.clientWidth, height: element.clientHeight }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Position at a fixed phase of a unit spring from rest, as a function of the damping ratio alone. */
function progressAtPhase(ratio: number) {
  return springAt({ type: 'spring', stiffness: 1, damping: 2 * ratio, mass: 1 }, 0, 0, 1, HANDLE_PHASE).position;
}

/** The damping ratio that puts the spring at `progress` when it reaches the handle's phase. */
function ratioFor(progress: number) {
  let lo = 0.05;
  let hi = 6;
  // Progress falls as damping rises, so a plain bisection finds it.
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (progressAtPhase(mid) > progress) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How far along the handle can sit: from the most damped spring to the least. */
const PROGRESS = { min: progressAtPhase(6), max: progressAtPhase(0.05) };

export interface PlotProps {
  session: Session;
  snap: Snapshot;
  showcase: Showcase;
  /** Drawn at the component's own scale, beside it, with the same pixel for the same height. */
  attached: boolean;
  /** Where the top of the component sits, in this plot's pixels. Only used when attached. */
  originY: number;
  /** How far left of the plot the component's edge is. Level lines reach back to it. */
  reach: number;
  onSpring: (curve: SpringCurve) => void;
}

/**
 * The instrument. Time runs left to right and the followed edge is drawn in real pixels, so the
 * line is what the edge of the component does. Each bar is the edge at one frame.
 */
export const Plot = memo(function Plot({ session, snap, showcase, attached, originY, reach, onSpring }: PlotProps) {
  const plot = useRef<HTMLDivElement>(null);
  const reveal = useRef<SVGRectElement>(null);
  const head = useRef<SVGGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const arm = useRef<SVGLineElement>(null);
  const rivalDot = useRef<SVGCircleElement>(null);
  const seekHandle = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(plot);
  const { domain, timeline, ghost, rival, take, steps, marker, levels, spec } = snap;
  const span = domain.end - domain.start;
  const origin = domain.start + LEAD_MS;
  const direction = Math.sign(levels.high - levels.low) || 1;
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);

  const scale = useMemo(() => {
    const x = (t: number) => ((t - domain.start) / span) * width;
    if (attached) return { x, y: (value: number) => originY + value, value: (py: number) => py - originY, ky: 1 };
    const lo = Math.min(levels.low, levels.high);
    const hi = Math.max(levels.low, levels.high);
    const pad = Math.max(1, (hi - lo) * 0.14);
    const top = 16;
    const bottom = Math.max(top + 10, height - AXIS - 8);
    const ky = (bottom - top) / (hi - lo + 2 * pad);
    return { x, y: (value: number) => top + (value - (lo - pad)) * ky, value: (py: number) => (py - top) / ky + (lo - pad), ky };
  }, [attached, originY, domain, span, width, height, levels]);

  const paths = useMemo(() => {
    if (width === 0) return null;
    const { x, y } = scale;
    const count = Math.max(60, Math.round(width / 2));
    const line = (source: Timeline, from: number, to: number) => {
      let d = '';
      const n = Math.max(2, Math.round((count * (to - from)) / span));
      for (let i = 0; i <= n; i += 1) {
        const t = from + ((to - from) * i) / n;
        d += `${i === 0 ? 'M' : 'L'}${round(x(t))} ${round(y(edgeAt(source, showcase, t, levels).position))}`;
      }
      return d;
    };
    const base = y(levels.low);
    const bars = (source: Timeline, from: number, to: number) => {
      let d = '';
      const step = x(origin + FRAME_MS) - x(origin);
      const gap = step > 3.5 ? 1 : 0;
      for (let i = Math.ceil((from - origin) / FRAME_MS - 1e-6); origin + i * FRAME_MS < to; i += 1) {
        const t = origin + i * FRAME_MS;
        const edge = y(edgeAt(source, showcase, t, levels).position);
        if (Math.abs(edge - base) < 0.75) continue;
        const x1 = round(x(t) + gap / 2);
        const x2 = round(x(t + FRAME_MS) - gap / 2);
        const r = Math.min(1.5, (x2 - x1) / 2, Math.abs(edge - base) / 2) * Math.sign(edge - base);
        d += `M${x1} ${round(base)}H${x2}V${round(edge - r)}Q${x2} ${round(edge)} ${round(x2 - Math.abs(r))} ${round(edge)}H${round(x1 + Math.abs(r))}Q${x1} ${round(edge)} ${x1} ${round(edge - r)}Z`;
      }
      return d;
    };
    const cut = marker === null ? null : take.events[marker]!.atMs;
    return {
      take: line(timeline, domain.start, domain.end),
      bars: bars(timeline, origin, lastMark(timeline).settleMs),
      ghost: ghost && cut !== null ? line(ghost, cut, domain.end) : null,
      rival: rival ? line(rival, domain.start, domain.end) : null,
    };
  }, [scale, width, timeline, ghost, rival, domain, span, origin, levels, marker, take, showcase]);

  const timeAt = (clientX: number) => {
    const box = plot.current!.getBoundingClientRect();
    return domain.start + (clamp(clientX - box.left, 0, box.width) / box.width) * span;
  };

  useEffect(() => {
    if (width === 0) return undefined;
    const draw = (t: number) => {
      const at = clamp(scale.x(t), 0, width);
      const y = scale.y(edgeAt(timeline, showcase, t, levels).position);
      reveal.current!.setAttribute('width', at.toFixed(1));
      head.current!.setAttribute('transform', `translate(${at.toFixed(1)} 0)`);
      dot.current!.setAttribute('cy', y.toFixed(1));
      arm.current!.setAttribute('x2', at.toFixed(1));
      arm.current!.setAttribute('y1', y.toFixed(1));
      arm.current!.setAttribute('y2', y.toFixed(1));
      if (rival && rivalDot.current) rivalDot.current.setAttribute('cy', scale.y(edgeAt(rival, showcase, t, levels).position).toFixed(1));
      seekHandle.current!.setAttribute('aria-valuenow', String(Math.round(t - domain.start)));
      seekHandle.current!.setAttribute('aria-valuetext', `${Math.max(0, Math.round(t - origin))} ms`);
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, timeline, rival, domain, origin, width, scale, levels, showcase]);

  const dragging = useRef<number | 'seek' | 'spring' | null>(null);

  // The spring handle rides the first command's own curve, wherever the take goes afterwards.
  const first = take.events[0];
  const curve = curveOf(spec, showcase, 'go');
  const tunable = first?.command === showcase.go && take.initialState === showcase.from && levels.high !== levels.low;
  const frequency = Math.sqrt(curve.stiffness / curve.mass);
  const handleMs = (HANDLE_PHASE / frequency) * 1000;
  const handleValue = springAt(curve, levels.low, 0, levels.high, HANDLE_PHASE / frequency).position;

  function springFrom(clientX: number, clientY: number) {
    const box = plot.current!.getBoundingClientRect();
    const ms = clamp(timeAt(clientX) - first!.atMs, 12, 900);
    const stiffness = clamp(curve.mass * (HANDLE_PHASE / (ms / 1000)) ** 2, STIFFNESS.min, STIFFNESS.max);
    const progress = (scale.value(clientY - box.top) - levels.low) / (levels.high - levels.low);
    const ratio = ratioFor(clamp(progress, PROGRESS.min, PROGRESS.max));
    onSpring(tidy({ ...curve, stiffness, damping: 2 * ratio * Math.sqrt(stiffness * curve.mass) }));
  }

  function press(event: PointerEvent, what: number | 'seek' | 'spring') {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging.current = what;
    if (what === 'seek') session.seek(timeAt(event.clientX));
    else if (what === 'spring') session.holdAxis(true);
    else session.beginDrag(what);
  }
  function move(event: PointerEvent) {
    if (dragging.current === 'seek') session.seek(timeAt(event.clientX));
    else if (dragging.current === 'spring') springFrom(event.clientX, event.clientY);
    else if (dragging.current !== null) session.moveMarker(dragging.current, timeAt(event.clientX));
  }
  function release() {
    if (typeof dragging.current === 'number') session.endDrag();
    if (dragging.current === 'spring') session.holdAxis(false);
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
  function springKey(event: KeyboardEvent) {
    const big = event.shiftKey ? 5 : 1;
    // Sideways moves the handle in time. Up and down move it on the page, whichever way is forward.
    const change: Record<string, Partial<SpringCurve>> = {
      ArrowLeft: { stiffness: curve.stiffness + STIFFNESS.step * big },
      ArrowRight: { stiffness: curve.stiffness - STIFFNESS.step * big },
      ArrowUp: { damping: curve.damping + DAMPING.step * big * direction },
      ArrowDown: { damping: curve.damping - DAMPING.step * big * direction },
    };
    const next = change[event.key];
    if (!next) return;
    event.preventDefault();
    onSpring(tidy({ ...curve, ...next }));
  }

  const stepEvery = width < 300 ? 400 : 200;
  const ticks: number[] = [];
  for (let t = 0; t <= span - LEAD_MS; t += 100) ticks.push(t);
  const floor = height - AXIS;
  const { x, y } = scale;

  return (
    <div className="plot" ref={plot} data-attached={attached || undefined} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
      <svg width={width} height={height} aria-hidden="true">
        <defs>
          <clipPath id="curve-reveal">
            <rect ref={reveal} x={-reach} y={-40} width={0} height={height + 80} />
          </clipPath>
        </defs>
        <line className="level" x1={-reach} x2={width} y1={y(levels.low)} y2={y(levels.low)} />
        <line className="level" x1={-reach} x2={width} y1={y(levels.high)} y2={y(levels.high)} />
        <text className="level-name" x={width} y={y(levels.low) - 5}>{showcase.registration.states[showcase.from]!.label}</text>
        <text className="level-name" x={width} y={y(levels.high) + (direction > 0 ? 13 : -5)}>{showcase.registration.states[showcase.to]!.label}</text>
        <line className="axis" x1={0} x2={width} y1={floor} y2={floor} />
        {ticks.map((t) => (
          <g key={t} transform={`translate(${round(x(origin + t))} 0)`}>
            <line className="tick" y1={floor} y2={floor + (t % stepEvery === 0 ? 5 : 3)} />
            {t % stepEvery === 0 ? <text className="tick-label" y={height - 4} textAnchor={t === 0 ? 'start' : 'middle'}>{t === 0 ? '0 ms' : t}</text> : null}
          </g>
        ))}
        {paths ? (
          <>
            <path className="bars" d={paths.bars} />
            {paths.ghost ? <path className="line-ghost" d={paths.ghost} /> : null}
            {paths.rival ? <path className="line-rival" d={paths.rival} /> : null}
            <path className="line-ahead" d={paths.take} />
            <path className="line-take" d={paths.take} clipPath="url(#curve-reveal)" />
          </>
        ) : null}
        {take.events.slice(1).map((event, i) => {
          const reading = edgeAt(timeline, showcase, event.atMs, levels);
          const outcome = steps.find((item) => item.atMs === event.atMs && item.command === event.command)?.outcome;
          if (outcome !== 'start' || Math.abs(reading.velocity) < 20) return null;
          // The slope of the line at this moment, which is the speed the new spring starts with.
          const dx = (x(origin + 1000) - x(origin)) / 1000;
          const dy = (reading.velocity * scale.ky) / 1000;
          const length = Math.hypot(dx, dy);
          const ux = (dx / length) * 34;
          const uy = (dy / length) * 34;
          const px = x(event.atMs);
          const py = y(reading.position);
          return <line key={i} className="tangent" x1={round(px - ux)} y1={round(py - uy)} x2={round(px + ux)} y2={round(py + uy)} />;
        })}
        <line ref={arm} className="arm" x1={-reach} x2={0} y1={0} y2={0} />
        <g ref={head}>
          <line className="playhead" x1={0} x2={0} y1={0} y2={floor} />
          {rival ? <circle ref={rivalDot} className="playhead-dot rival" cx={0} cy={0} r={3} /> : null}
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

      <p className="legend" aria-hidden="true">
        <span><i className="key" />What happened</span>
        {paths?.ghost ? <span><i className="key dotted" />With no interruption</span> : null}
        {rival ? <span><i className="key rival" />Side B</span> : null}
      </p>

      {first ? <span className="first" style={{ left: x(first.atMs), height: floor }}>{label(showcase, first.command)}</span> : null}

      {take.events.slice(1).map((event, i) => {
        const index = i + 1;
        const outcome = steps.find((item) => item.atMs === event.atMs && item.command === event.command)?.outcome;
        const ms = Math.round(event.atMs - origin);
        const reading = edgeAt(timeline, showcase, event.atMs, levels);
        const name = label(showcase, event.command);
        return (
          <div
            key={index}
            className="marker"
            role="slider"
            tabIndex={0}
            data-active={index === marker || undefined}
            data-outcome={outcome}
            data-flip={x(event.atMs) > width - 128 || undefined}
            style={{ left: x(event.atMs), height: floor }}
            aria-label={`When ${name} lands, after ${label(showcase, first!.command)}`}
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={ms}
            aria-valuetext={`${ms} ms`}
            onKeyDown={(keyEvent) => markerKey(keyEvent, index, event.atMs)}
            onPointerDown={(pointerEvent) => press(pointerEvent, index)}
          >
            <i style={{ top: y(reading.position) }} />
            <span>
              <b>{name}</b> {ms} ms
              {outcome === 'start' && index === marker && Math.abs(reading.velocity) >= 20 ? <em>{Math.round(Math.abs(reading.velocity)).toLocaleString('en-US')} px/s kept</em> : null}
              {outcome === 'queue' ? <em>waits</em> : null}
              {outcome === 'ignore' ? <em>ignored</em> : null}
            </span>
          </div>
        );
      })}

      {tunable && first ? (
        <div
          className="spring-handle"
          role="slider"
          tabIndex={0}
          style={{ left: x(first.atMs + handleMs), top: y(handleValue) }}
          aria-label={`Spring for ${go}, sideways for stiffness, up and down for damping`}
          aria-valuemin={STIFFNESS.min}
          aria-valuemax={STIFFNESS.max}
          aria-valuenow={curve.stiffness}
          aria-valuetext={`Stiffness ${curve.stiffness}, damping ${curve.damping}`}
          onKeyDown={springKey}
          onPointerDown={(event) => press(event, 'spring')}
        >
          <i />
        </div>
      ) : null}
      <span className="sr-only">{`${back} can be moved along the take, and the spring handle reshapes ${go}`}</span>
    </div>
  );
});

/** Speed on the same time axis. It stays one unbroken line through a reversal that keeps speed. */
export const Velocity = memo(function Velocity({ session, snap, showcase }: { session: Session; snap: Snapshot; showcase: Showcase }) {
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<SVGGElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const { width, height } = useSize(box);
  const { domain, timeline, ghost, rival, take, marker, levels } = snap;
  const span = domain.end - domain.start;
  const direction = Math.sign(levels.high - levels.low) || 1;

  const drawn = useMemo(() => {
    if (width === 0) return null;
    const count = Math.max(60, Math.round(width / 2));
    const x = (t: number) => ((t - domain.start) / span) * width;
    const read = (source: Timeline, from: number) => {
      const n = Math.max(2, Math.round((count * (domain.end - from)) / span));
      return Array.from({ length: n + 1 }, (_, i) => {
        const t = from + ((domain.end - from) * i) / n;
        return { t, v: edgeAt(source, showcase, t, levels).velocity * direction };
      });
    };
    const cut = marker === null ? null : take.events[marker]!.atMs;
    const main = read(timeline, domain.start);
    const other = ghost && cut !== null ? read(ghost, cut) : null;
    const second = rival ? read(rival, domain.start) : null;
    const all = [...main, ...(other ?? []), ...(second ?? [])];
    const peak = Math.max(300, ...all.map((point) => point.v));
    const trough = Math.min(0, ...all.map((point) => point.v));
    const top = 6;
    const bottom = height - 6;
    const y = (v: number) => top + ((peak - v) / (peak - trough)) * (bottom - top);
    const line = (points: { t: number; v: number }[]) => points.map((point, i) => `${i === 0 ? 'M' : 'L'}${round(x(point.t))} ${round(y(point.v))}`).join('');
    const zero = round(y(0));
    return {
      x,
      y,
      zero,
      peak: Math.max(...main.map((point) => Math.abs(point.v))),
      area: `${line(main)}L${round(x(domain.end))} ${zero}L${round(x(domain.start))} ${zero}Z`,
      main: line(main),
      ghost: other ? line(other) : null,
      rival: second ? line(second) : null,
      cut: cut === null ? null : round(x(cut)),
    };
  }, [width, height, timeline, ghost, rival, domain, span, marker, take, levels, direction, showcase]);

  useEffect(() => {
    if (!drawn) return undefined;
    const draw = (t: number) => {
      head.current!.setAttribute('transform', `translate(${clamp(drawn.x(t), 0, width).toFixed(1)} 0)`);
      dot.current!.setAttribute('cy', drawn.y(edgeAt(timeline, showcase, t, levels).velocity * direction).toFixed(1));
    };
    draw(session.time());
    return session.onFrame(draw);
  }, [session, drawn, timeline, levels, direction, width, showcase]);

  return (
    <div className="velocity" ref={box}>
      <svg width={width} height={height} aria-hidden="true">
        {drawn ? (
          <>
            <line className="level" x1={0} x2={width} y1={drawn.zero} y2={drawn.zero} />
            {drawn.cut !== null ? <line className="cut" x1={drawn.cut} x2={drawn.cut} y1={0} y2={height} /> : null}
            <path className="speed-area" d={drawn.area} />
            {drawn.ghost ? <path className="line-ghost" d={drawn.ghost} /> : null}
            {drawn.rival ? <path className="line-rival" d={drawn.rival} /> : null}
            <path className="line-take thin" d={drawn.main} />
            <g ref={head}>
              <line className="playhead" x1={0} x2={0} y1={0} y2={height} />
              <circle ref={dot} className="playhead-dot" cx={0} cy={0} r={3} />
            </g>
          </>
        ) : null}
      </svg>
      <span className="velocity-name">Speed{drawn ? `, peak ${Math.round(drawn.peak).toLocaleString('en-US')} px/s` : ''}</span>
    </div>
  );
});

/**
 * The take as a long exposure, in place. One outline for every other frame, so the lines crowd
 * where the edge slows and spread where it is fast, with the uninterrupted end dashed.
 */
export const Onion = memo(function Onion({ session, snap, showcase, left, top }: { session: Session; snap: Snapshot; showcase: Showcase; left: number; top: number }) {
  const { domain, timeline, ghost, rival, take, marker, levels } = snap;
  const origin = domain.start + LEAD_MS;
  const above = useRef<SVGRectElement>(null);
  const inside = showcase.track.edge === 'top';

  // A target that moves inside its component is drawn over it, but never over the target itself.
  useEffect(() => {
    if (!inside) return undefined;
    const draw = (t: number) => above.current!.setAttribute('height', Math.max(0, top + edgeAt(timeline, showcase, t, levels).position - 1).toFixed(1));
    draw(session.time());
    return session.onFrame(draw);
  }, [session, inside, timeline, levels, top, showcase]);
  const frames = useMemo(() => {
    const list: { key: number; x: number; y: number; width: number; height: number }[] = [];
    const end = lastMark(timeline).settleMs;
    for (let i = 0; origin + i * FRAME_MS * 2 < end; i += 1) {
      const extent = extentAt(timeline, showcase, origin + i * FRAME_MS * 2, levels);
      if (!extent.drawn || extent.bottom - extent.top < 1) continue;
      list.push({ key: i, x: extent.x, y: extent.top, width: extent.width, height: extent.bottom - extent.top });
    }
    return list;
  }, [timeline, origin, levels, showcase]);

  const box = (source: Timeline, t: number) => {
    const extent = extentAt(source, showcase, t, levels);
    return extent.drawn && extent.bottom - extent.top >= 1 ? extent : null;
  };
  const cut = marker === null ? null : box(timeline, take.events[marker]!.atMs);
  const end = ghost ? box(ghost, domain.end) : null;
  const other = rival ? box(rival, domain.end) : null;
  const rect = (extent: NonNullable<ReturnType<typeof box>>, className: string) => (
    <rect className={className} x={round(left + extent.x) + 0.5} y={round(top + extent.top) + 0.5} width={Math.max(0, round(extent.width) - 1)} height={Math.max(0, round(extent.bottom - extent.top) - 1)} rx={showcase.radius} />
  );

  return (
    <svg className="onion" aria-hidden="true" clipPath={inside ? 'url(#onion-above)' : undefined}>
      {inside ? (
        <defs>
          <clipPath id="onion-above" clipPathUnits="userSpaceOnUse">
            <rect ref={above} x={0} y={0} width={4000} height={0} />
          </clipPath>
        </defs>
      ) : null}
      {end ? rect(end, 'onion-end') : null}
      {frames.map((frame) => (
        <rect key={frame.key} className="onion-frame" x={round(left + frame.x) + 0.5} y={round(top + frame.y) + 0.5} width={Math.max(0, round(frame.width) - 1)} height={Math.max(0, round(frame.height) - 1)} rx={showcase.radius} />
      ))}
      {cut ? rect(cut, 'onion-cut') : null}
      {other && !end ? rect(other, 'onion-end') : null}
    </svg>
  );
});
