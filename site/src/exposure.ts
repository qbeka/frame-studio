import type { Timeline } from '../../packages/studio/runtime/timeline';
import type { Showcase } from './showcase';
import { extentAt, type Levels } from './trace';

/**
 * A take as a long exposure. The shutter is open from the first event until the motion rests, and
 * the followed target leaves its outline wherever it is, so ink builds up with time spent: a slow
 * settle prints a dense band, a snap prints almost nothing, and every turning point is a dark
 * line. On top of that a flash fires once a display frame at 60 Hz and prints one crisp outline.
 *
 * These are moments worked out from the take. Nothing here reads what the browser painted.
 */
export interface PlateSource {
  timeline: Timeline;
  showcase: Showcase;
  levels: Levels;
}

/** Where component pixels land on the canvas: canvas = offset + component * scale. */
export interface PlateMap {
  scale: number;
  left: number;
  top: number;
}

export interface PlateInk {
  color: string;
  /** Darkness one shutter step adds where the outline sits. */
  dwell: number;
  /** Darkness of one flash. */
  flash: number;
  /** Darkness one shutter step adds to everything the target covers, on a layer of its own. */
  wash: number;
  /** The darkest that layer is ever shown, so a hand that waits a long time does not black the plate out. */
  washCeiling: number;
  /** Line width in canvas pixels. */
  line: number;
}

/** The shutter step. Small enough that the fastest edge here moves about three pixels in one. */
export const SHUTTER_MS = 2;
export const FLASH_MS = 1000 / 60;

export const PLATE_INK: PlateInk = { color: '#1d3a2a', dwell: 0.04, flash: 0.2, wash: 0.004, washCeiling: 0.2, line: 1 };

function outline(ctx: CanvasRenderingContext2D, source: PlateSource, t: number, map: PlateMap): boolean {
  const { timeline, showcase, levels } = source;
  const extent = extentAt(timeline, showcase, t, levels);
  if (!extent.drawn || extent.bottom - extent.top < 0.5) return false;
  const x = map.left + extent.x * map.scale;
  const y = map.top + extent.top * map.scale;
  const width = extent.width * map.scale;
  const height = (extent.bottom - extent.top) * map.scale;
  const radius = Math.min(showcase.radius * map.scale, width / 2, height);
  ctx.beginPath();
  if (showcase.track.edge === 'top') {
    // The component cuts this target off at its own bottom edge, so that side is left open.
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height);
  } else {
    ctx.roundRect(x, y, width, height, Math.min(radius, height / 2));
  }
  return true;
}

/**
 * Exposes the plate for the moments after `fromMs` up to and including `toMs`. Steps sit on a
 * fixed grid from `originMs`, so exposing a take in pieces prints exactly what one pass would.
 * The outlines go on `ctx`. The wash, which is everything the target covers, goes on `wash`, and
 * whoever shows the plate lays it under the outlines at `washCeiling`.
 */
export function expose(
  ctx: CanvasRenderingContext2D,
  wash: CanvasRenderingContext2D,
  source: PlateSource,
  originMs: number,
  fromMs: number,
  toMs: number,
  map: PlateMap,
  ink: PlateInk = PLATE_INK,
): void {
  ctx.save();
  wash.save();
  ctx.strokeStyle = ink.color;
  ctx.lineWidth = ink.line;
  ctx.lineJoin = 'round';
  ctx.globalAlpha = ink.dwell;
  wash.fillStyle = ink.color;
  wash.globalAlpha = ink.wash;
  for (let k = Math.floor((fromMs - originMs) / SHUTTER_MS) + 1; originMs + k * SHUTTER_MS <= toMs; k += 1) {
    if (k < 0) continue;
    const t = originMs + k * SHUTTER_MS;
    if (!outline(ctx, source, t, map)) continue;
    ctx.stroke();
    if (outline(wash, source, t, map)) wash.fill();
  }
  ctx.globalAlpha = ink.flash;
  for (let k = Math.floor((fromMs - originMs) / FLASH_MS) + 1; originMs + k * FLASH_MS <= toMs; k += 1) {
    if (k < 0) continue;
    if (outline(ctx, source, originMs + k * FLASH_MS, map)) ctx.stroke();
  }
  wash.restore();
  ctx.restore();
}

/** Exposes a whole take onto one canvas in a single pass, for a print or a small frame. */
export function print(ctx: CanvasRenderingContext2D, source: PlateSource, originMs: number, toMs: number, map: PlateMap, ink: PlateInk = PLATE_INK): void {
  const { width, height } = ctx.canvas;
  const lines = document.createElement('canvas');
  const wash = document.createElement('canvas');
  lines.width = wash.width = width;
  lines.height = wash.height = height;
  expose(lines.getContext('2d')!, wash.getContext('2d')!, source, originMs, originMs - 1, toMs, map, ink);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = ink.washCeiling;
  ctx.drawImage(wash, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(lines, 0, 0);
  ctx.restore();
}

/** One crisp outline of the target at a moment, for the state a take starts or ends in. */
export function stamp(ctx: CanvasRenderingContext2D, source: PlateSource, t: number, map: PlateMap, style: { color: string; width: number; dash?: number[] }): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash ?? []);
  if (outline(ctx, source, t, map)) ctx.stroke();
  ctx.restore();
}

/** The box the target sweeps through between two moments, in component pixels. */
export function sweptBox(source: PlateSource, fromMs: number, toMs: number) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const steps = Math.max(1, Math.ceil((toMs - fromMs) / 4));
  for (let i = 0; i <= steps; i += 1) {
    const extent = extentAt(source.timeline, source.showcase, fromMs + ((toMs - fromMs) * i) / steps, source.levels);
    if (!extent.drawn) continue;
    left = Math.min(left, extent.x);
    right = Math.max(right, extent.x + extent.width);
    top = Math.min(top, extent.top);
    bottom = Math.max(bottom, extent.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}
