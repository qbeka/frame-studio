import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { measureTargets } from '../../runtime/dom';
import type { FrameHandle } from '../../runtime/react';
import type { MotionSpec, Rects } from '../../runtime/spec';
import type { AnyRegistration } from '../../authoring/registration';
import type { PropsRecord, Session } from './session';

export interface ProbeHandle {
  measure(state: string, props: PropsRecord): Rects;
}

/**
 * The geometry probe renders a second, invisible copy of the component with no motion applied.
 * Adding an interruption to a take can ask for the layout of a state and content that was never
 * on screen together. The probe answers that without disturbing what you are looking at.
 */
function useProbe(spec: MotionSpec) {
  const elements = useRef(new Map<string, HTMLElement>());
  const root = useRef<HTMLElement | null>(null);
  const [probe, setProbe] = useState<{ state: string; props: PropsRecord } | null>(null);
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const frame: FrameHandle | null = probe && {
    state: probe.state,
    send() {},
    remeasure() {},
    root: () => ({ ref: (element) => void (root.current = element), 'data-frame-root': '' }),
    target(id) {
      let ref = refs.current.get(id);
      if (!ref) {
        ref = (element) => {
          if (element) elements.current.set(id, element);
          else elements.current.delete(id);
        };
        refs.current.set(id, ref);
      }
      const present = spec.states[probe.state]?.targets[id]?.present !== false;
      return {
        ref,
        'data-frame-target': id,
        ...(spec.targets[id]?.bounds === 'surface' ? { 'data-frame-surface': '' as const } : {}),
        ...(present ? {} : { hidden: true }),
      };
    },
  };
  return { elements, root, probe, setProbe, frame };
}

export const Canvas = forwardRef<ProbeHandle, { registration: AnyRegistration; session: Session; spec: MotionSpec }>(
  function Canvas({ registration, session, spec }, ref) {
    const { elements, root, probe, setProbe, frame } = useProbe(spec);
    const stage = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      measure(state, props) {
        flushSync(() => setProbe({ state, props }));
        // flushSync does nothing inside React's own work, and measuring then would be wrong.
        if (!root.current) throw new Error('The geometry probe has not rendered.');
        return measureTargets(root.current!, elements.current, (id) => spec.states[state]?.targets[id]?.present === true);
      },
    }));

    const inspecting = session.mode !== 'live';
    return (
      <main className="canvas" aria-label="Live component">
        <div className="stage" ref={stage} data-inspecting={inspecting || undefined}>
          <p className="ui stage-label">
            <span>{registration.id}</span>
            <b>{spec.states[session.controller.getState()]?.label}</b>
          </p>
          {inspecting ? <p className="ui stage-note">Paused on a recorded moment. Input is off.</p> : null}
          <div key={session.generation.key} className="stage-live" {...(inspecting ? { inert: true } : {})}>
            {registration.render({ frame: session.frame, props: session.props, setProps: session.setProps })}
          </div>
          {probe && frame ? (
            <div className="stage-probe" aria-hidden="true" inert>
              {registration.render({ frame, props: probe.props, setProps() {} })}
            </div>
          ) : null}
        </div>
      </main>
    );
  },
);
