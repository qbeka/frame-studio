/**
 * MotionSpec, format version 1. This is the data a runtime needs and nothing else.
 *
 * Units are part of the names on purpose. Time is milliseconds except where a name says
 * seconds. Positions and sizes are CSS pixels. Opacity and scale are unitless.
 *
 * Validation lives in the studio package, so that the parser never reaches a consumer bundle.
 * The runtime trusts a MotionSpec because the exporter only writes parsed ones.
 */
export const MOTION_FORMAT = 'frame.motion';
export const MOTION_VERSION = 1;

/**
 * A damped spring: mass * x'' + damping * x' + stiffness * (x - target) = 0.
 * Stiffness is in newtons per metre, damping in newton seconds per metre and mass in
 * kilograms, with one CSS pixel standing in for one metre. Only the ratios matter.
 */
export interface SpringCurve {
  type: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
}

/** A timed curve. `easing` is the CSS cubic-bezier(x1, y1, x2, y2) control points. */
export interface TweenCurve {
  type: 'tween';
  durationMs: number;
  easing: [number, number, number, number];
}

export type Curve = SpringCurve | TweenCurve;

export interface Timing {
  curve: Curve;
  delayMs: number;
}

/** Channels that share one timing. `position` is x and y, `size` is width and height. */
export type PropertyGroup = 'position' | 'size' | 'opacity' | 'scale';

/**
 * How a target draws its measured layout bounds. See docs/DESIGN.md.
 * - translate: moves with a transform and snaps its size. Safe for text.
 * - surface: a text-free absolute layer, sized directly. It cannot push siblings.
 * - clip: reveals content with clip-path inset in pixels. Children do not move.
 * - scale: fits with a scale transform. Rejected on targets that hold text.
 */
export type BoundsMode = 'translate' | 'surface' | 'clip' | 'scale';

export interface TargetSpec {
  bounds: BoundsMode;
  /** True when the target holds text. Text is never scaled. */
  text: boolean;
  /** Corner radius for the `clip` representation, in CSS pixels. */
  clipRadiusPx: number;
}

/** A target's pose in one state, as an offset from its measured layout box. */
export interface StateTargetValue {
  /** False means the target is hidden and out of flow in this state. */
  present: boolean;
  opacity: number;
  xPx: number;
  yPx: number;
  scale: number;
}

export interface StateSpec {
  label: string;
  /** Target that receives focus when focus would otherwise be lost entering this state. */
  focusTarget: string | null;
  targets: Record<string, StateTargetValue>;
}

/**
 * What to do when `command` lands while a transition is running.
 * - retarget: leave now, from the current position and speed.
 * - queue: finish first, then run the command at the exact settle time.
 * - ignore: drop the command.
 * `curve` replaces the transition's curves and delays for a retarget. Null keeps them.
 */
export interface InterruptionRule {
  command: string;
  policy: 'retarget' | 'queue' | 'ignore';
  curve: Curve | null;
}

/** `instant` jumps. `fade` jumps travel and fades opacity over `durationMs`. */
export interface ReducedMotionRule {
  policy: 'instant' | 'fade';
  durationMs: number;
}

export interface TransitionSpec {
  id: string;
  from: string;
  to: string;
  command: string;
  timing: Timing;
  /** Per target overrides of `timing`. */
  targets: Record<string, Partial<Record<PropertyGroup, Timing>>>;
  /** A rule naming the command wins. Otherwise the first rule with command "*" applies. */
  interruptions: InterruptionRule[];
  reducedMotion: ReducedMotionRule;
}

/**
 * A channel counts as settled once it stays inside both thresholds. It then lands on its
 * exact target, so the final jump is at most these distances.
 */
export interface SettleThresholds {
  px: number;
  pxPerSecond: number;
  unit: number;
  unitPerSecond: number;
}

export interface MotionSpec {
  format: typeof MOTION_FORMAT;
  version: typeof MOTION_VERSION;
  component: { id: string; version: string };
  initialState: string;
  commands: string[];
  targets: Record<string, TargetSpec>;
  states: Record<string, StateSpec>;
  transitions: TransitionSpec[];
  settle: SettleThresholds;
  /** What a viewport resize does to a running transition. */
  resize: 'retarget' | 'snap';
}

/** A layout box in CSS pixels, relative to the padding box of the registered root. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rects = Record<string, Rect>;
