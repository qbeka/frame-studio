import { buildExport, RUNTIME_FILES } from '../../packages/studio/authoring/export';
import { createZip } from '../../packages/studio/authoring/zip';
import type { MotionSpec } from '../../packages/studio/runtime/spec';

/** Kept out of the first load. The page only needs this once someone opens Export. */
const sources = import.meta.glob('../../packages/studio/runtime/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function exportFor(spec: MotionSpec, name: string, transitionId: string) {
  const runtime: Record<string, string> = {};
  for (const file of RUNTIME_FILES) runtime[file] = sources[`../../packages/studio/runtime/${file}`]!;
  const files = buildExport(spec, runtime, sources['../../packages/studio/runtime/frame.css']!, { tool: 'frame-studio 0.1.0' });
  const config = files.find((file) => file.path === 'motion.config.ts')!.content;
  // The preview runs the text of the generated file, so it can only show what the file says.
  const body = config.slice(config.indexOf('= {') + 2, config.lastIndexOf(';'));
  const exported = JSON.parse(body) as MotionSpec;
  const shown = exported.transitions.find((transition) => transition.id === transitionId)!;
  const excerpt = JSON.stringify({ id: shown.id, timing: shown.timing, interruptions: shown.interruptions }, null, 2);
  return {
    spec: exported,
    excerpt,
    transitionId,
    files: files.map((file) => ({ path: file.path, bytes: new TextEncoder().encode(file.content).length })),
    download() {
      const zip = createZip(files.map((file) => ({ path: `${name}/${file.path}`, content: file.content })));
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

export type ExportBundle = ReturnType<typeof exportFor>;
