import { buildExport, RUNTIME_FILES } from '../../packages/studio/authoring/export';
import { createZip } from '../../packages/studio/authoring/zip';
import type { MotionSpec } from '../../packages/studio/runtime/spec';

/** Kept out of the first load. The page only needs this once someone presses Export. */
const sources = import.meta.glob('../../packages/studio/runtime/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const NAME = 'expense-panel-motion';

export function exportFor(spec: MotionSpec) {
  const runtime: Record<string, string> = {};
  for (const name of RUNTIME_FILES) runtime[name] = sources[`../../packages/studio/runtime/${name}`]!;
  const files = buildExport(spec, runtime, sources['../../packages/studio/runtime/frame.css']!, { tool: 'frame-studio 0.1.0' });
  const config = files.find((file) => file.path === 'motion.config.ts')!.content;
  // The preview runs the text of the generated file, so it can only show what the file says.
  const body = config.slice(config.indexOf('= {') + 2, config.lastIndexOf(';'));
  const exported = JSON.parse(body) as MotionSpec;
  const open = exported.transitions.find((transition) => transition.id === 'open')!;
  const excerpt = JSON.stringify({ id: open.id, timing: open.timing, interruptions: open.interruptions }, null, 2);
  return {
    spec: exported,
    excerpt,
    files: files.map((file) => ({ path: file.path, bytes: new TextEncoder().encode(file.content).length })),
    download() {
      const zip = createZip(files.map((file) => ({ path: `${NAME}/${file.path}`, content: file.content })));
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${NAME}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

export type ExportBundle = ReturnType<typeof exportFor>;
