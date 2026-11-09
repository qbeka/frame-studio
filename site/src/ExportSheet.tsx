import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PropValue } from '../../packages/studio/authoring/registration';
import type { ExportBundle } from './exportFiles';
import { Follower } from './Follower';
import { announce } from './Rail';
import type { Session, Snapshot } from './session';
import type { Showcase } from './showcase';

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** Where the followed edge is really drawn, in pixels from the top of that copy of the component. */
function drawnEdge(scope: Element | null | undefined, showcase: Showcase): number | null {
  const root = scope?.querySelector('[data-frame-root]');
  const target = scope?.querySelector<HTMLElement>(`[data-frame-target=${showcase.track.target}]`);
  if (!root || !target) return null;
  const outer = root.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return outer.height;
  return (showcase.track.edge === 'top' ? Math.min(box.top, outer.bottom) : box.bottom) - outer.top;
}

/** Both copies' real drawn edge, read from the page after every frame. */
function Compare({ session, showcase, stage }: { session: Session; showcase: Showcase; stage: RefObject<HTMLElement | null> }) {
  const ours = useRef<HTMLElement>(null);
  const theirs = useRef<HTMLElement>(null);
  const gap = useRef<HTMLElement>(null);
  useEffect(() => {
    const draw = () => {
      const a = drawnEdge(stage.current?.querySelector('.live'), showcase);
      const b = drawnEdge(stage.current?.querySelector('#exported'), showcase);
      if (a === null || b === null || !ours.current) return;
      ours.current.textContent = `${a.toFixed(1)} px`;
      theirs.current!.textContent = `${b.toFixed(1)} px`;
      gap.current!.textContent = `${Math.abs(a - b).toFixed(3)} px`;
    };
    draw();
    // After every frame listener, so the preview has already moved to this moment.
    return session.onFrame(() => queueMicrotask(draw));
  }, [session, showcase, stage]);
  return (
    <dl className="score">
      <div><dt>This page</dt><dd className="num" id="edge-ours" ref={ours as RefObject<HTMLElement>} /></div>
      <div><dt>Exported</dt><dd className="num" id="edge-exported" ref={theirs as RefObject<HTMLElement>} /></div>
      <div><dt>Apart</dt><dd className="num" id="edge-gap" ref={gap as RefObject<HTMLElement>} /></div>
    </dl>
  );
}

export function ExportSheet({
  snap,
  session,
  showcase,
  props,
  stage,
  onReady,
}: {
  snap: Snapshot;
  session: Session;
  showcase: Showcase;
  props: Record<string, PropValue>;
  stage: RefObject<HTMLElement | null>;
  onReady: () => void;
}) {
  const [make, setMake] = useState<typeof import('./exportFiles').exportFor | null>(null);
  const [view, setView] = useState<'preview' | 'files'>('preview');
  const [saved, setSaved] = useState(false);
  const version = useRef(0);
  const shown = snap.spec.transitions.find((item) => item.command === showcase.go && item.from === showcase.from)!.id;
  const bundle: ExportBundle | null = useMemo(() => {
    version.current += 1;
    return make?.(snap.spec, showcase.exportName, shown) ?? null;
  }, [make, snap.spec, showcase, shown]);

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
    if (!saved) return undefined;
    const id = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(id);
  }, [saved]);

  const total = bundle?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0;

  return (
    <div className="sheet">
      <section className="group">
        <header>
          <h2>Exported build</h2>
          <button
            type="button"
            className="control primary swap"
            id="download"
            aria-disabled={!bundle || undefined}
            onClick={() => {
              if (!bundle) return;
              bundle.download();
              setSaved(true);
              announce(`Saved ${showcase.exportName}.zip`);
            }}
          >
            <span className={saved ? '' : 'on'}>Download zip</span>
            <span className={saved ? 'on' : ''}>Saved</span>
          </button>
        </header>
        <div className="seg" role="group" aria-label="Export view">
          <button type="button" className="control" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Running</button>
          <button type="button" className="control" aria-pressed={view === 'files'} onClick={() => setView('files')}>Files</button>
        </div>
      </section>
      {bundle ? (
        <>
          <div className="lane" id="exported" inert hidden={view !== 'preview'}>
            <Follower key={version.current} spec={bundle.spec} showcase={showcase} session={session} take={snap.take} props={props} />
          </div>
          {view === 'preview' ? (
            <>
              <Compare session={session} showcase={showcase} stage={stage} />
              <p className="note">
                This copy runs the motion.config.ts from the download, on the same runtime source the zip holds, inside this page. It gets your take as named commands and measures its own layout. A <a href="studio/try/">separate built app</a> uses those files with the default motion.
              </p>
            </>
          ) : (
            <div className="files" tabIndex={0} role="group" aria-label="Exported files">
              <p className="note">motion.config.ts, the {bundle.transitionId} transition</p>
              <pre>{bundle.excerpt}</pre>
              <ul>
                {bundle.files.map((file) => (
                  <li key={file.path}><span>{file.path}</span><span>{size(file.bytes)}</span></li>
                ))}
                <li className="sum"><span>{bundle.files.length} files of source</span><span>{size(total)}</span></li>
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="note">Building the files.</p>
      )}
    </div>
  );
}
