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
  const { inspectAt, playhead, resetTo } = session;

  // Undo, redo, opening a file and recovering a draft all replace the project from outside the
  // session, so the session catches up here. A take reopens exactly where it can be inspected.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (shown.current === store.revision) return;
    const first = shown.current === null;
    shown.current = store.revision;
    if (take) {
      const timeline = session.replay(take, spec).timeline;
      const range = takeRange(take, timeline);
      const t = first ? range.end : Math.max(range.start, Math.min(range.end, playhead.get()));
      inspectAt(take, spec, t);
    } else if (!first) {
      resetTo(spec.initialState);
    }
  });

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
      <aside className="pane pane-left" aria-label="States and transitions">
        <StatePanel spec={spec} current={session.controller.getState()} selection={selection} onSelect={setSelection} />
      </aside>
      <Canvas ref={probeRef} registration={registration} session={session} spec={spec} />
      <aside className="pane pane-right" aria-label="Properties">
        <PropertyPanel spec={spec} selection={selection} store={store} session={session} />
      </aside>
      <Transport spec={spec} take={take} session={session} store={store} />
    </div>
  );
}
