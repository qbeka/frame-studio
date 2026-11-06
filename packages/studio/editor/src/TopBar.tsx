import { useRef, useState } from 'react';
import { buildExport, checkAgainstRegistration, createZip, parseProject, reportConversions, RUNTIME_FILES, serializeProject, type Problem } from '../../authoring';
import type { AnyRegistration } from '../../authoring/registration';
import { blankProjectFor } from './blank';
import { clearDraft, type ProjectStore } from './store';
import type { Session } from './session';

const sources = import.meta.glob('../../runtime/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function exportFiles(spec: Parameters<typeof buildExport>[0]) {
  const runtime: Record<string, string> = {};
  for (const name of RUNTIME_FILES) runtime[name] = sources[`../../runtime/${name}`]!;
  return buildExport(spec, runtime, sources['../../runtime/frame.css']!, { tool: 'frame-studio 0.1.0' });
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportDialog({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const { spec } = store.project;
  const files = exportFiles(spec);
  const name = `${spec.component.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-motion`;
  const [done, setDone] = useState(false);
  const bytes = files.reduce((sum, f) => sum + new TextEncoder().encode(f.content).length, 0);
  const conversions = reportConversions(spec);
  return (
    <dialog className="dialog" open aria-label="Export">
      <h2 className="dialog-title">Export working files</h2>
      <p>Copy the folder into your source tree. It needs React and a TypeScript bundler, and nothing from Frame.</p>
      <pre className="code">{`import { useFrame } from './motion/runtime';
import { motion } from './motion/motion.config';
import './motion/frame.css';

const frame = useFrame(motion);
// <section {...frame.root()}>
//   <div {...frame.target('surface')} />`}</pre>
      <details>
        <summary>{files.length} files, {(bytes / 1024).toFixed(1)} KB of source</summary>
        <ul className="file-list">
          {files.map((f) => <li key={f.path}><span>{f.path}</span><span className="mono">{(f.content.length / 1024).toFixed(1)} KB</span></li>)}
        </ul>
      </details>
      <details>
        <summary>Why there is no CSS export</summary>
        <ul className="file-list">
          {conversions.map((c) => <li key={c.transition}><span>{c.transition}: {c.reasons[0] ?? 'No blockers, but CSS output is not built yet.'}</span></li>)}
        </ul>
      </details>
      <div className="dialog-actions">
        {import.meta.env.VITE_FRAME_TRY ? <a className="link dialog-try" href="./try/">Try this interaction as a built export</a> : null}
        {done ? <span className="status" role="status">Downloaded {name}.zip</span> : null}
        <button type="button" className="button" onClick={onClose}>Close</button>
        <button
          type="button"
          className="button button-dark"
          onClick={() => {
            const zip = createZip(files.map((f) => ({ path: `${name}/${f.path}`, content: f.content })));
            download(`${name}.zip`, zip as BlobPart, 'application/zip');
            setDone(true);
          }}
        >
          Download zip
        </button>
      </div>
    </dialog>
  );
}

function ImportErrors({ problems, onClose }: { problems: Problem[]; onClose: () => void }) {
  return (
    <dialog className="dialog" open aria-label="This file was not opened" role="alertdialog">
      <h2 className="dialog-title">This file was not opened</h2>
      <p>Your current project has not changed.</p>
      <ul className="problems">
        {problems.slice(0, 12).map((p, i) => <li key={i}><code>{p.path}</code> {p.message}</li>)}
      </ul>
      {problems.length > 12 ? <p className="hint">And {problems.length - 12} more.</p> : null}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}

export function TopBar({
  store,
  session,
  registrations,
  registration,
  onPickRegistration,
  recoveredAt,
}: {
  store: ProjectStore;
  session: Session;
  registrations: AnyRegistration[];
  registration: AnyRegistration;
  onPickRegistration: (index: number) => void;
  recoveredAt: string | null;
}) {
  const [exporting, setExporting] = useState(false);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(recoveredAt);
  const input = useRef<HTMLInputElement>(null);
  const { spec, name } = store.project;

  function saveProject() {
    const file = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'project'}.frame.json`;
    download(file, store.serialized, 'application/json');
    store.markSaved(store.serialized);
    setRecovered(null);
    setNotice(`Saved ${file}`);
  }

  async function openFile(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      setProblems([{ path: file.name, message: `is not valid JSON. ${(error as Error).message}` }]);
      return;
    }
    const result = parseProject(parsed);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    const mismatch = checkAgainstRegistration(result.value.spec, registration);
    if (mismatch.length > 0) {
      setProblems(mismatch);
      return;
    }
    store.replace(result.value, serializeProject(result.value));
    setRecovered(null);
    setNotice(`Opened ${file.name}`);
  }

  function discardDraft() {
    clearDraft(spec.component.id);
    const blank = blankProjectFor(registration);
    store.replace(blank, serializeProject(blank));
    session.resetTo(blank.spec.initialState);
    setRecovered(null);
  }

  return (
    <header className="ui topbar">
      <h1 className="brand">Frame</h1>
      {registrations.length > 1 ? (
        <select aria-label="Component" value={registration.id} onChange={(e) => onPickRegistration(registrations.findIndex((r) => r.id === e.target.value))}>
          {registrations.map((r) => <option key={r.id}>{r.id}</option>)}
        </select>
      ) : null}
      <input className="project-name" aria-label="Project name" value={name} onChange={(e) => store.rename(e.target.value)} />
      <span className="status" role="status" data-testid="save-status">
        {store.dirty ? 'Unsaved changes' : (notice ?? 'Saved')}
      </span>
      {recovered ? (
        <span className="recovered" role="status">
          Recovered your draft from {new Date(recovered).toLocaleTimeString()}.{' '}
          <button type="button" className="link" onClick={discardDraft}>Discard it</button>
        </span>
      ) : null}
      <div className="grow" />
      <button type="button" className="button" disabled={!store.canUndo} onClick={store.undo} aria-keyshortcuts="Meta+Z">Undo</button>
      <button type="button" className="button" disabled={!store.canRedo} onClick={store.redo} aria-keyshortcuts="Meta+Shift+Z">Redo</button>
      <button type="button" className="button" onClick={() => input.current?.click()}>Open</button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Open a project file"
        data-testid="open-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = '';
        }}
      />
      <button type="button" className="button" onClick={saveProject}>Save project</button>
      <button type="button" className="button button-dark" onClick={() => setExporting(true)}>Export</button>
      {exporting ? <ExportDialog store={store} onClose={() => setExporting(false)} /> : null}
      {problems ? <ImportErrors problems={problems} onClose={() => setProblems(null)} /> : null}
    </header>
  );
}
