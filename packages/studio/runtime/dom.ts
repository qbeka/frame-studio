import type { MotionSpec, Rect, Rects } from './spec';
import type { Sample, TargetSample } from './timeline';

/**
 * Geometry measurement and the rendering adapter. All DOM access in the runtime is here.
 *
 * Boxes are relative to the padding box of the root. That makes page scrolling a non-event: both
 * the root and its targets move together, so nothing has to be recomputed. Ancestor transforms
 * are not corrected for, because a scaled ancestor would change what a CSS pixel means. This is
 * a documented limit.
 */

/** Removes everything the renderer wrote, so that a read sees true native layout. */
function clearDrawnStyles(element: HTMLElement) {
  const { style } = element;
  style.transform = '';
  style.transformOrigin = '';
  style.clipPath = '';
  style.left = '';
  style.top = '';
  style.right = '';
  style.bottom = '';
  style.width = '';
  style.height = '';
  style.opacity = '';
}

/**
 * Reads the endpoint layout. Writes then reads in one go, inside a single task, so the browser
 * paints none of it. Costs one forced layout however many targets there are.
 */
export function measureTargets(
  root: HTMLElement,
  elements: Map<string, HTMLElement>,
  isInFlow: (id: string) => boolean,
): Rects {
  const rects: Rects = {};
  const measured: [string, HTMLElement][] = [];
  for (const [id, element] of elements) {
    if (!isInFlow(id)) continue;
    element.removeAttribute('data-frame-exiting');
    clearDrawnStyles(element);
    measured.push([id, element]);
  }
  const origin = root.getBoundingClientRect();
  const left = origin.left + root.clientLeft;
  const top = origin.top + root.clientTop;
  for (const [id, element] of measured) {
    const box = element.getBoundingClientRect();
    rects[id] = { x: box.left - left, y: box.top - top, width: box.width, height: box.height };
  }
  return rects;
}

const fixed = (n: number) => (Math.round(n * 1000) / 1000).toString();
const px = (n: number) => `${fixed(n)}px`;

function drawClip(element: HTMLElement, s: TargetSample, box: Rect, radius: number) {
  const top = s.y - box.y;
  const left = s.x - box.x;
  const bottom = box.y + box.height - (s.y + s.height);
  const right = box.x + box.width - (s.x + s.width);
  const flush = Math.abs(top) + Math.abs(left) + Math.abs(bottom) + Math.abs(right) < 0.001;
  // Negative insets are allowed on purpose: shrinking content may reach past the new box.
  const round = radius > 0 ? ` round ${px(radius)}` : '';
  element.style.clipPath = flush ? '' : `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)}${round})`;
}

function drawSurface(element: HTMLElement, s: TargetSample, box: Rect) {
  const { style } = element;
  const flush =
    Math.abs(s.x - box.x) + Math.abs(s.y - box.y) + Math.abs(s.width - box.width) + Math.abs(s.height - box.height) <
    0.001;
  if (flush) {
    style.left = style.top = style.right = style.bottom = style.width = style.height = style.transform = '';
    return;
  }
  style.left = style.top = '0px';
  style.right = style.bottom = 'auto';
  style.width = px(Math.max(0, s.width));
  style.height = px(Math.max(0, s.height));
  style.transform = `translate(${px(s.x)}, ${px(s.y)})`;
}

function drawTransform(element: HTMLElement, s: TargetSample, box: Rect, fitSize: boolean) {
  const dx = s.x - box.x;
  const dy = s.y - box.y;
  const sx = fitSize && box.width > 0 ? (s.width / box.width) * s.scale : s.scale;
  const sy = fitSize && box.height > 0 ? (s.height / box.height) * s.scale : s.scale;
  const moved = Math.abs(dx) + Math.abs(dy) >= 0.001;
  const scaled = Math.abs(sx - 1) + Math.abs(sy - 1) >= 0.0001;
  const parts: string[] = [];
  if (moved) parts.push(`translate(${px(dx)}, ${px(dy)})`);
  if (scaled) parts.push(`scale(${fixed(sx)}, ${fixed(sy)})`);
  element.style.transform = parts.join(' ');
  element.style.transformOrigin = scaled && fitSize ? '0 0' : '';
}

function drawExiting(element: HTMLElement, s: TargetSample, box: Rect) {
  const { style } = element;
  element.setAttribute('data-frame-exiting', '');
  element.inert = true;
  style.left = style.top = '0px';
  style.width = px(box.width);
  style.height = px(box.height);
  style.transform = `translate(${px(s.x)}, ${px(s.y)})${s.scale === 1 ? '' : ` scale(${fixed(s.scale)})`}`;
}

/** Draws one sample. It reads no layout, so a frame costs writes only. */
export function drawSample(spec: MotionSpec, elements: Map<string, HTMLElement>, sample: Sample) {
  for (const [id, element] of elements) {
    const s = sample.targets[id];
    if (!s) continue;
    const box = s.box;
    if (!s.inFlow && !s.exiting) {
      if (element.hasAttribute('data-frame-exiting')) element.removeAttribute('data-frame-exiting');
      element.inert = false;
      clearDrawnStyles(element);
      continue;
    }
    if (!box) continue;
    element.style.opacity = s.opacity >= 0.9995 ? '' : fixed(Math.max(0, Math.min(1, s.opacity)));
    if (s.exiting) {
      drawExiting(element, s, box);
      continue;
    }
    if (element.hasAttribute('data-frame-exiting')) {
      element.removeAttribute('data-frame-exiting');
      element.inert = false;
      clearDrawnStyles(element);
      element.style.opacity = s.opacity >= 0.9995 ? '' : fixed(Math.max(0, Math.min(1, s.opacity)));
    }
    const target = spec.targets[id]!;
    if (target.bounds === 'surface') drawSurface(element, s, box);
    else if (target.bounds === 'clip') drawClip(element, s, box, target.clipRadiusPx);
    else drawTransform(element, s, box, target.bounds === 'scale');
  }
}

const FOCUSABLE = 'button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])';

/** Focuses the target or the first focusable element inside it. Never scrolls. */
export function focusTarget(element: HTMLElement) {
  const inner = element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE);
  (inner ?? element).focus({ preventScroll: true });
}

/** A target inside another moving target would move twice. Only `clip` wrappers can nest. */
export function findBadNesting(spec: MotionSpec, elements: Map<string, HTMLElement>): string[] {
  const bad: string[] = [];
  for (const [id, element] of elements) {
    for (const [otherId, other] of elements) {
      if (id === otherId || !other.contains(element)) continue;
      if (spec.targets[otherId]?.bounds !== 'clip') bad.push(id);
    }
  }
  return bad;
}
