'use client';

import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createController, type FrameController, type FrameOptions } from './controller';
import type { MotionSpec } from './spec';

export interface FrameRootProps {
  ref: (element: HTMLElement | null) => void;
  'data-frame-root': '';
}

export interface FrameTargetProps {
  ref: (element: HTMLElement | null) => void;
  'data-frame-target': string;
  'data-frame-surface'?: '';
  hidden?: boolean;
}

/** All a component needs from Frame. It is the same in the studio and in production. */
export interface FrameHandle {
  /** The semantic state. Render your native layout from this. */
  state: string;
  send(command: string): void;
  root(): FrameRootProps;
  target(id: string): FrameTargetProps;
  /** Tell Frame the layout changed outside a React render of this component. */
  remeasure(): void;
}

export function useFrameController(controller: FrameController, spec: MotionSpec): FrameHandle {
  // The version moves on every dispatch, so a transition back to the same state still renders.
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const refs = useMemo(() => new Map<string, (element: HTMLElement | null) => void>(), [controller]);

  // No dependency list: any commit can change layout, and this exits early when nothing runs.
  useLayoutEffect(() => controller.commit());
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const state = controller.getState();
  const refFor = (id: string) => {
    let ref = refs.get(id);
    if (!ref) {
      ref = (element) => controller.setTarget(id, element);
      refs.set(id, ref);
    }
    return ref;
  };

  return {
    state,
    send: controller.send,
    remeasure: controller.remeasure,
    root: () => ({ ref: controller.setRoot, 'data-frame-root': '' }),
    target(id) {
      const props: FrameTargetProps = { ref: refFor(id), 'data-frame-target': id };
      if (spec.targets[id]?.bounds === 'surface') props['data-frame-surface'] = '';
      if (spec.states[state]?.targets[id]?.present === false) props.hidden = true;
      return props;
    },
  };
}

/** Binds a component to a MotionSpec. SSR renders the initial state with no DOM access. */
export function useFrame(spec: MotionSpec, options?: FrameOptions): FrameHandle {
  const [controller] = useState(() => createController(spec, options));
  return useFrameController(controller, spec);
}
