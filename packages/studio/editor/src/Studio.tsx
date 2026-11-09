import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnyRegistration } from '../../authoring/registration';
import type { Project } from '../../authoring/project';
import { useProjectStore } from './store';
import { takeRange, useSession, type PropsRecord } from './session';
import { Canvas, type ProbeHandle } from './Canvas';
import { TopBar } from './TopBar';
import { StatePanel, type Selection } from './StatePanel';
import { PropertyPanel } from './PropertyPanel';
import { Transport } from './Transport';

interface StudioProps {
  registration: AnyRegistration;
  registrations: AnyRegistration[];
  onPickRegistration: (index: number) => void;
  initial: Project;
  saved: string;
  recoveredAt: string | null;
}

export function Studio({ registration, registrations, onPickRegistration, initial, saved, recoveredAt }: StudioProps) {
  const store = useProjectStore(initial, saved);
  const { spec, take } = store.project;
  const [selection, setSelection] = useState<Selection>({ kind: 'transition', id: spec.transitions[0]?.id ?? '' });
  const probeRef = useRef<ProbeHandle | null>(null);
  const probe = useCallback((state: string, props: PropsRecord) => probeRef.current!.measure(state, props), []);
  const session = useSession({ registration, spec, take, setTake: store.setTake, probe });
  const { inspectAt, playhead, resetTo, showExample } = session;
  // A first visit opens on the registration's example take. A recovered draft is the visitor's own
  // work and wins, ?take=none opens empty, and the manual test clock never loads one.
  const wantsExample = useRef(
    recoveredAt === null && initial.take === null && Boolean(registration.exampleTake) && !/[?&](take=none|clock=manual)(&|$)/.test(location.search),
  );

  // Undo, redo, opening a file and recovering a draft all replace the project from outside the
  // session, so the session catches up here. It runs in a task of its own, because a replay may
  // need the probe, and the probe cannot render from inside an effect. A take that cannot be
  // restored must not take the app down with it, so that failure resets to a working component.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (shown.current === store.revision) return undefined;
    const first = shown.current === null;
    shown.current = store.revision;
    const timer = setTimeout(() => {
      try {
        if (take) {
          const range = takeRange(take, session.replay(take, spec).timeline);
          const t = first ? range.end : Math.max(range.start, Math.min(range.end, playhead.get()));
          inspectAt(take, spec, t);
        } else if (!first) {
          resetTo(spec.initialState);
        }
      } catch (error) {
        console.warn('Frame could not restore this take.', error);
        resetTo(spec.initialState);
      }
    });
    return () => clearTimeout(timer);
  });

  // In a task of its own for the same reason as above, and once only. It does not ride on the
  // effect above, whose timer is dropped by any render that lands before it fires.
  const latestExample = useRef(showExample);
  latestExample.current = showExample;
  useEffect(() => {
    if (!wantsExample.current) return undefined;
    const timer = setTimeout(() => {
      try {
        latestExample.current(store.seedTake);
      } catch (error) {
        console.warn('Frame could not load the example take.', error);
      }
    });
    return () => clearTimeout(timer);
  }, [store.seedTake]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if ((event.target as HTMLElement).closest('input,textarea')) return;
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store.undo, store.redo]);

  return (
    <div className="studio">
      <TopBar store={store} session={session} registrations={registrations} registration={registration} onPickRegistration={onPickRegistration} recoveredAt={recoveredAt} />
      <aside className="ui pane pane-left" aria-label="States and transitions">
        <StatePanel spec={spec} current={session.controller.getState()} selection={selection} onSelect={setSelection} />
      </aside>
      <Canvas ref={probeRef} registration={registration} session={session} spec={spec} />
      <aside className="ui pane pane-right" aria-label="Properties">
        <PropertyPanel spec={spec} selection={selection} store={store} session={session} />
      </aside>
      <Transport spec={spec} take={take} session={session} store={store} canLoadExample={Boolean(registration.exampleTake)} />
    </div>
  );
}
