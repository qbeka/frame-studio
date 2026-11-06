import { useMemo, useState } from 'react';
import { buildExport, createZip, RUNTIME_FILES } from '../../authoring';
import type { AnyRegistration } from '../../authoring/registration';
import type { ProjectStore } from './store';
import type { Session } from './session';

const sources = import.meta.glob('../../runtime/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function runtimeFiles() {
  const runtime: Record<string, string> = {};
  for (const name of RUNTIME_FILES) runtime[name] = sources[`../../runtime/${name}`]!;
  return { runtime, css: sources['../../runtime/frame.css']! };
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TopBar({ store }: { store: ProjectStore; session: Session; registrations: AnyRegistration[]; registration: AnyRegistration; onPickRegistration: (i: number) => void; recoveredAt: string | null }) {
  const [exported, setExported] = useState<string | null>(null);
  const { spec } = store.project;
  const name = useMemo(() => spec.component.id.replace(/[^a-z0-9]+/gi, '-'), [spec]);

  function exportZip() {
    const { runtime, css } = runtimeFiles();
    const files = buildExport(spec, runtime, css, { tool: 'frame-studio 0.1.0' });
    download(`${name}-motion.zip`, createZip(files.map((f) => ({ path: `${name}-motion/${f.path}`, content: f.content }))) as BlobPart, 'application/zip');
    setExported(`Exported ${files.length} files.`);
  }

  function saveProject() {
    download(`${name}.frame.json`, store.serialized, 'application/json');
    store.markSaved(store.serialized);
  }

  return (
    <header className="topbar">
      <span className="brand">Frame</span>
      <span className="status" role="status">{store.dirty ? 'Unsaved changes' : 'Saved'}</span>
      <div className="grow" />
      {exported ? <span className="status">{exported}</span> : null}
      <button type="button" className="button" onClick={saveProject}>Save project</button>
      <button type="button" className="button button-dark" onClick={exportZip}>Export</button>
    </header>
  );
}
