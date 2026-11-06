import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Inspector, type InspectorProps } from '@frame-studio/fixture-inspector';
import { createController } from '../../packages/studio/runtime/controller';
import { useFrameController } from '../../packages/studio/runtime/react';
import type { ExportBundle } from './exportFiles';
import type { Session, Snapshot, Take } from './session';

const noop = () => {};

/** Steps by hand, so the exported panel stays on the same frame as the take beside it. */
function createFollowClock() {
  let time = 0;
  let waiting: (() => void) | null = null;
  return {
    now: () => time,
    set(t: number) {
      time = t;
    },
    requestFrame(callback: () => void) {
      waiting = callback;
      return () => {
        waiting = null;
      };
    },
    advanceTo(t: number) {
      time = t;
      const run = waiting;
      waiting = null;
      run?.();
    },
  };
}

/**
 * The exported spec on the exported runtime, with no history and no seeking. It gets the take's
 * commands at their recorded times and works out everything else for itself.
 */
function Preview({ bundle, session, take, props }: { bundle: ExportBundle; session: Session; take: Take; props: InspectorProps }) {
  const clock = useMemo(createFollowClock, []);
  const controller = useMemo(() => createController(bundle.spec, { clock }), [bundle, clock]);
  const frame = useFrameController(controller, bundle.spec);
  const latest = useRef(take);
  latest.current = take;

  useLayoutEffect(() => {
    let ran: Take | null = null;
    let sent = 0;
    let last = Number.NEGATIVE_INFINITY;
    const restart = () => {
      const current = latest.current;
      clock.set(current.startMs);
      controller.setSpec({ ...bundle.spec, initialState: current.initialState });
      flushSync(() => controller.reset(current.initialState));
      ran = current;
      sent = 0;
    };
    const follow = (t: number) => {
      const current = latest.current;
      const sameStart = ran !== null && ran.startMs === current.startMs && ran.initialState === current.initialState;
      const sameSoFar = sameStart && ran!.events.slice(0, sent).every((event, i) => event.atMs === current.events[i]?.atMs && event.command === current.events[i]?.command);
      if (!sameSoFar || t < last) restart();
      ran = current;
      while (sent < current.events.length && current.events[sent]!.atMs <= t) {
        const event = current.events[sent]!;
        clock.advanceTo(event.atMs);
        flushSync(() => controller.send(event.command));
        sent += 1;
      }
      clock.advanceTo(t);
      last = t;
    };
    const stop = session.onFrame(follow);
    follow(session.time());
    return stop;
  }, [bundle, clock, controller, session]);

  return <Inspector frame={frame} props={props} setProps={noop} />;
}

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export function ExportSheet({
  snap,
  session,
  props,
  onClose,
  onReady,
}: {
  snap: Snapshot;
  session: Session;
  props: InspectorProps;
  onClose: () => void;
  onReady: () => void;
}) {
  const [make, setMake] = useState<((spec: Snapshot['spec']) => ExportBundle) | null>(null);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [saved, setSaved] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const version = useRef(0);
  const bundle = useMemo(() => {
    version.current += 1;
    return make?.(snap.spec) ?? null;
  }, [make, snap.spec]);

  useEffect(() => {
    let live = true;
    void import('./exportFiles').then(({ exportFor }) => {
      if (live) setMake(() => exportFor);
    });
    return () => {
      live = false;
    };
  }, []);

  const announced = useRef(false);
  useEffect(() => {
    if (!bundle || announced.current) return;
    announced.current = true;
    onReady();
  }, [bundle, onReady]);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(id);
  }, [saved]);

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div className="row" role="group" aria-label="Export view">
          <button type="button" className="control" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
          <button type="button" className="control" aria-pressed={view === 'code'} onClick={() => setView('code')}>Code</button>
        </div>
        <button type="button" className="control primary save" aria-disabled={!bundle || undefined} onClick={() => {
          if (!bundle) return;
          bundle.download();
          setSaved(true);
        }}>
          <span className={saved ? '' : 'on'}>Download</span>
          <span className={saved ? 'on' : ''}>Saved</span>
        </button>
        <button ref={close} type="button" className="control close" aria-label="Close export" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        </button>
      </div>
      {bundle ? (
        <>
          <div className="exported" id="exported" inert hidden={view !== 'preview'}>
            <Preview key={version.current} bundle={bundle} session={session} take={snap.take} props={props} />
          </div>
          {view === 'code' ? (
            <div className="code" tabIndex={0} role="group" aria-label="Exported files">
              <p className="note">motion.config.ts, the Open transition</p>
              <pre>{bundle.excerpt}</pre>
              <ul>
                {bundle.files.map((file) => (
                  <li key={file.path}><span>{file.path}</span><span>{size(file.bytes)}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
