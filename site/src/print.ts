import { RULES, curveOf, feelOf, policyOf } from './motion';
import { PLATE_INK, expose, stamp, sweptBox, type PlateMap, type PlateSource } from './exposure';
import { LEAD_MS, TAIL_MS, type Snapshot } from './session';
import type { Showcase } from './showcase';
import { edgeAt } from './trace';
import { caption } from './words';

/**
 * A take as an image to keep: its long exposure on the left and its trace on the right, at one
 * scale, so a dark line on the plate sits level with the turn in the curve that made it.
 */
const PAPER = '#ffffff';
const GROUND = '#fbfaf7';
const INK = '#111511';
const BODY = '#444944';
const MUTED = '#535753';
const FOREST = '#1d3a2a';
const LINE = 'rgba(17, 21, 17, 0.18)';
const HAIR = 'rgba(17, 21, 17, 0.09)';

/** What the art is drawn from. A snapshot of the stage has all of it, and a figure can make its own. */
export type ArtSource = Pick<Snapshot, 'timeline' | 'ghost' | 'levels' | 'domain' | 'hands' | 'take' | 'marker' | 'takeEnd'>;

export interface ArtBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draws the plate and the trace into a box. `unit` is the size of one hairline, in canvas pixels. */
export function drawArt(ctx: CanvasRenderingContext2D, snap: ArtSource, showcase: Showcase, box: ArtBox, unit: number, plateShare = 0.4): void {
  const { timeline, ghost, levels, domain, hands, take, marker } = snap;
  const source: PlateSource = { timeline, showcase, levels };
  const first = domain.start + LEAD_MS;
  const rest = snap.takeEnd - TAIL_MS;
  const lo = Math.min(levels.low, levels.high);
  const hi = Math.min(levels.clip, Math.max(levels.low, levels.high));
  const swept = sweptBox(source, domain.start, snap.takeEnd) ?? { left: 0, top: 0, width: showcase.width, height: hi };
  const top = Math.min(swept.top, lo) - 6;
  const bottom = Math.max(swept.top + swept.height, hi) + 6;
  const gapPx = box.width * 0.06;
  const scale = Math.min((box.width * plateShare) / swept.width, box.height / (bottom - top));
  const plateWidth = swept.width * scale;
  const map: PlateMap = { scale, left: box.x - swept.left * scale, top: box.y + (box.height - (bottom - top) * scale) / 2 - top * scale };
  const yOf = (value: number) => map.top + value * scale;

  // The plate.
  expose(ctx, source, first, first - 1, rest, map, { ...PLATE_INK, dwell: Math.min(0.6, PLATE_INK.dwell * 1.25), flash: PLATE_INK.flash * 1.1, line: unit * 1.25 });
  stamp(ctx, source, domain.start, map, { color: INK, width: unit * 1.5 });

  // The trace, on the same vertical scale.
  const left = box.x + plateWidth + gapPx;
  const right = box.x + box.width;
  const xOf = (t: number) => left + ((t - domain.start) / (domain.end - domain.start)) * (right - left);
  const path = (from: number, to: number, of = timeline) => {
    ctx.beginPath();
    const n = Math.max(2, Math.round((xOf(to) - xOf(from)) / 2));
    for (let i = 0; i <= n; i += 1) {
      const t = from + ((to - from) * i) / n;
      const y = yOf(edgeAt(of, showcase, t, levels).position);
      if (i === 0) ctx.moveTo(xOf(t), y);
      else ctx.lineTo(xOf(t), y);
    }
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // The two resting levels run from the plate across the trace.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = unit;
  for (const level of [levels.low, levels.high]) {
    ctx.beginPath();
    ctx.moveTo(box.x + plateWidth, yOf(Math.min(level, levels.clip)));
    ctx.lineTo(right, yOf(Math.min(level, levels.clip)));
    ctx.stroke();
  }
  if (ghost && marker !== null) {
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = unit * 1.5;
    ctx.setLineDash([unit, unit * 5]);
    path(take.events[marker]!.atMs, domain.end, ghost);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = FOREST;
  ctx.lineWidth = unit * 3;
  path(domain.start, domain.end);
  ctx.stroke();
  for (const hand of hands) {
    const until = hand.toMs ?? rest;
    ctx.strokeStyle = INK;
    ctx.lineWidth = unit * 3;
    path(hand.fromMs, until);
    ctx.stroke();
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = INK;
    ctx.lineWidth = unit * 1.5;
    const every = Math.max(1, Math.ceil(hand.samples.length / 60));
    hand.samples.forEach((t, i) => {
      if (i % every !== 0) return;
      ctx.beginPath();
      ctx.arc(xOf(t), yOf(edgeAt(timeline, showcase, t, levels).position), unit * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    if (hand.toMs !== null) {
      ctx.beginPath();
      ctx.arc(xOf(hand.toMs), yOf(edgeAt(timeline, showcase, hand.toMs, levels).position), unit * 6, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = unit * 2;
      ctx.stroke();
    }
  }
  // A press that interrupts is a filled dot on the line.
  take.events.forEach((event, i) => {
    if (i === 0 || event.type !== 'command' || hands.some((hand) => hand.toMs === event.atMs)) return;
    ctx.beginPath();
    ctx.arc(xOf(event.atMs), yOf(edgeAt(timeline, showcase, event.atMs, levels).position), unit * 5.5, 0, Math.PI * 2);
    ctx.fillStyle = FOREST;
    ctx.fill();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = unit * 2;
    ctx.stroke();
  });
  ctx.restore();
}

async function fonts(sizes: string[]) {
  try {
    await Promise.all(sizes.map((font) => document.fonts.load(font)));
  } catch {
    // The print still draws in the fallback face.
  }
}

/** The whole print: a title, the art and a caption that says what the take was. */
export async function renderPrint(snap: Snapshot, showcase: Showcase, address: string): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d')!;
  await fonts(["56px 'Geist Serif'", "24px 'Geist'"]);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = GROUND;
  ctx.beginPath();
  ctx.roundRect(48, 148, 1504, 660, 24);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = "56px 'Geist Serif', 'Times New Roman', serif";
  ctx.fillText('Frame', 60, 108);
  ctx.font = "24px 'Geist', system-ui, sans-serif";
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.fillText(showcase.name, 1540, 104);
  ctx.textAlign = 'left';

  drawArt(ctx, snap, showcase, { x: 112, y: 196, width: 1376, height: 564 }, 2);

  // Time along the bottom of the trace.
  const curve = curveOf(snap.spec, showcase, 'go');
  const rule = RULES.find((item) => item.policy === policyOf(snap.spec, showcase))!;
  const spring = feelOf(curve) ?? `${curve.stiffness} / ${curve.damping}`;
  const duration = Math.round(snap.takeEnd - TAIL_MS - snap.domain.start - LEAD_MS);
  ctx.fillStyle = BODY;
  ctx.font = "34px 'Geist Serif', 'Times New Roman', serif";
  ctx.fillText(caption(snap, showcase), 60, 884);
  ctx.fillStyle = MUTED;
  ctx.font = "22px 'Geist', system-ui, sans-serif";
  ctx.fillText(`${spring} spring, ${rule.label.toLowerCase()}, at rest after ${duration.toLocaleString('en-US')} ms`, 60, 936);
  ctx.textAlign = 'right';
  const shown = address.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  ctx.fillText(shown, 1540, 936);
  ctx.strokeStyle = HAIR;
  return canvas;
}

export async function savePrint(snap: Snapshot, showcase: Showcase, address: string): Promise<boolean> {
  try {
    const canvas = await renderPrint(snap, showcase, address);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frame-plate-${showcase.id}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
