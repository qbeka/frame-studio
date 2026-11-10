import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { PLATE_INK, expose, sweptBox, type PlateMap, type PlateSource } from './exposure';
import { LEAD_MS, TAIL_MS, type Preview, type Session, type Snapshot } from './session';
import type { Showcase } from './showcase';
import { edgeAt, type Levels } from './trace';

const ratio = () => Math.min(2, window.devicePixelRatio || 1);

/**
 * The long exposure of the take on the stage, in place behind the component, at its own scale.
 * It develops as the take runs: live under a hand, and again on every replay. Held at one moment
 * it shows the whole take.
 */
export const Plate = memo(function Plate({ session, snap, showcase, left, top }: { session: Session; snap: Snapshot; showcase: Showcase; left: number; top: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const film = useRef<HTMLCanvasElement | null>(null);
  const state = useRef({ epoch: -1, until: 0, width: 0, height: 0, left: NaN, top: NaN });
  const inside = showcase.track.edge === 'top';

  useLayoutEffect(() => {
    const element = canvas.current!;
    const size = () => {
      const scale = ratio();
      const width = Math.round(element.clientWidth * scale);
      const height = Math.round(element.clientHeight * scale);
      if (width === state.current.width && height === state.current.height) return;
      element.width = width;
      element.height = height;
      film.current ??= document.createElement('canvas');
      film.current.width = width;
      film.current.height = height;
      state.current = { ...state.current, width, height, epoch: -1 };
    };
    size();
    // On the next frame, so resizing the canvas is never done inside the observer's own pass.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        size();
        draw(session.time());
      });
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest = useRef({ snap, left, top });
  latest.current = { snap, left, top };

  function draw(t: number) {
    const element = canvas.current;
    const sheet = film.current;
    if (!element || !sheet || state.current.width === 0) return;
    const { snap: now, left: x, top: y } = latest.current;
    const scale = ratio();
    const first = now.domain.start + LEAD_MS;
    // The shutter closes when the motion rests. The air after it would only darken the last frame.
    const rest = now.takeEnd - TAIL_MS;
    const until = now.phase === 'paused' ? rest : Math.min(t, rest);
    const s = state.current;
    const ctx = sheet.getContext('2d')!;
    if (s.epoch !== now.epoch || until < s.until || s.left !== x || s.top !== y) {
      ctx.clearRect(0, 0, s.width, s.height);
      s.epoch = now.epoch;
      s.until = first - 1;
      s.left = x;
      s.top = y;
    }
    if (until > s.until) {
      const source: PlateSource = { timeline: now.timeline, showcase, levels: now.levels };
      const map: PlateMap = { scale, left: x * scale + 0.5, top: y * scale + 0.5 };
      expose(ctx, source, first, s.until, until, map, { ...PLATE_INK, line: scale });
      s.until = until;
    }
    const out = element.getContext('2d')!;
    out.clearRect(0, 0, s.width, s.height);
    out.drawImage(sheet, 0, 0);
    if (inside) {
      // A target that moves inside its component is printed over it, but never over itself.
      const edge = edgeAt(now.timeline, showcase, now.phase === 'paused' ? session.time() : t, now.levels).position;
      const bottom = Math.max(0, element.clientHeight - (y + edge) + 1);
      element.style.clipPath = `inset(${y}px 0 ${bottom}px 0)`;
    } else if (element.style.clipPath) {
      element.style.clipPath = '';
    }
  }

  useEffect(() => {
    draw(session.time());
    return session.onFrame(draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, snap, left, top, showcase]);

  return <canvas className="plate" ref={canvas} aria-hidden="true" data-inside={inside || undefined} />;
});

/**
 * One take as a small print: the travel of the followed edge fills the frame, with the same
 * exposure behind and the trace of the edge drawn across it.
 */
export const PlateThumb = memo(function PlateThumb({ preview, showcase, levels }: { preview: Preview | null; showcase: Showcase; levels: Levels }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const scale = ratio();
    const width = Math.round(element.clientWidth * scale);
    const height = Math.round(element.clientHeight * scale);
    element.width = width;
    element.height = height;
    if (!preview || width === 0) return;
    const ctx = element.getContext('2d')!;
    const source: PlateSource = { timeline: preview.timeline, showcase, levels };
    // Every frame on the strip shares one scale, so a take that travels further prints larger.
    const lo = Math.min(levels.low, levels.high);
    const hi = Math.min(levels.clip, Math.max(levels.low, levels.high));
    const air = (hi - lo) * 0.16;
    const fit = height / (hi - lo + 2 * air);
    const box = sweptBox(source, preview.startMs, preview.endMs) ?? { left: 0, top: 0, width: showcase.width, height: hi };
    const map: PlateMap = { scale: fit, left: (width - box.width * fit) / 2 - box.left * fit, top: -(lo - air) * fit };
    expose(ctx, source, preview.startMs, preview.startMs - 1, preview.endMs, map, { ...PLATE_INK, dwell: Math.min(0.4, PLATE_INK.dwell * fit * 2), flash: PLATE_INK.flash * 0.6, wash: PLATE_INK.wash * 0.6, line: Math.max(1, scale * 0.75) });
    const from = preview.startMs - LEAD_MS * 0.6;
    const to = preview.endMs + LEAD_MS * 0.6;
    ctx.beginPath();
    for (let i = 0; i <= width; i += 1) {
      const y = map.top + edgeAt(preview.timeline, showcase, from + ((to - from) * i) / width, levels).position * fit;
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.strokeStyle = PLATE_INK.color;
    ctx.lineWidth = 1.5 * scale;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [preview, showcase, levels]);
  return <canvas className="thumb" ref={canvas} aria-hidden="true" />;
});
