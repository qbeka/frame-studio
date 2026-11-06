import type { ReactNode } from 'react';
import type { FrameHandle } from '../runtime/react';
import type { BoundsMode, MotionSpec, PropertyGroup } from '../runtime/spec';

/**
 * A registration is the whole boundary between Frame and your component. Frame sees what is
 * declared here and nothing else. It does not read React internals, and it cannot import a
 * component that has not been registered.
 */
export type PropValue = string | number | boolean;

export type PropDefinition =
  | { type: 'string'; label: string; default: string }
  | { type: 'number'; label: string; default: number; min?: number; max?: number }
  | { type: 'boolean'; label: string; default: boolean }
  | { type: 'enum'; label: string; default: string; options: string[] };

export interface TargetDefinition {
  label: string;
  bounds: BoundsMode;
  /** True when the target holds text. Text is never scaled. */
  text: boolean;
  clipRadiusPx?: number;
}

export interface StateDefinition {
  label: string;
  /** Targets in document flow in this state. All others are hidden. */
  shows: string[];
  /** Receives focus when focus would otherwise be lost entering this state. */
  focus?: string;
}

export interface RenderContext<Props> {
  /** Wire your root, targets and commands to this. Production passes the same object. */
  frame: FrameHandle;
  /** Current values of the declared props. */
  props: Props;
  /** Changes declared props. The studio records this so a take can be scrubbed exactly. */
  setProps: (patch: Partial<Props>) => void;
}

export interface Registration<Props extends Record<string, PropValue> = Record<string, PropValue>> {
  id: string;
  /** Semver of the component. A project records the version it was authored against. */
  version: string;
  initialState: string;
  states: Record<string, StateDefinition>;
  targets: Record<string, TargetDefinition>;
  /** Named commands the component can send. Coordinates are never recorded, only these. */
  commands: Record<string, { label: string }>;
  /** Allowed moves. Each becomes an editable transition. */
  transitions: { id: string; from: string; to: string; command: string }[];
  /** Serializable inputs that controls may change. */
  props: { [K in keyof Props]: PropDefinition };
  /** A saved spec to start from. Without one, Frame writes a starter spec. */
  defaultSpec?: MotionSpec;
  /** Returns the fixture to a known state. Cancel timers and clear outside stores here. */
  reset: () => void;
  /** Draws the component. Called with the same context in every state. */
  render: (context: RenderContext<Props>) => ReactNode;
}

export function defineRegistration<Props extends Record<string, PropValue>>(
  registration: Registration<Props>,
): Registration<Props> {
  return registration;
}

export type AnyRegistration = Registration<any>;

/** Properties a target can animate. Anything else is rejected by the parser. */
export const PROPERTY_GROUPS: PropertyGroup[] = ['position', 'size', 'opacity', 'scale'];
