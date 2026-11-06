import type { MotionSpec, TransitionSpec } from '../runtime/spec';

/**
 * Builds the export folder. The output is plain files: the spec as typed TypeScript, the runtime
 * as readable source, the scoped CSS and a usage example. You copy the folder into your source
 * tree, so nothing depends on Frame, on a registry, or on this tool still existing.
 *
 * The runtime is copied rather than generated, so what you read is what the tests ran.
 */
export interface ExportFile {
  path: string;
  content: string;
}

/** Only what a consumer needs. `pure.ts` exists for the studio and tests. */
export const RUNTIME_FILES = [
  'spec.ts',
  'spring.ts',
  'tween.ts',
  'channel.ts',
  'timeline.ts',
  'dom.ts',
  'controller.ts',
  'react.ts',
  'index.ts',
];

export interface ConversionReport {
  transition: string;
  css: 'not-exported';
  reasons: string[];
}

/**
 * Frame only exports the runtime today. This says why a CSS or Web Animations version would not
 * keep the declared behavior, transition by transition, instead of generating something close.
 */
export function reportConversions(spec: MotionSpec): ConversionReport[] {
  return spec.transitions.map((t) => ({
    transition: t.id,
    css: 'not-exported',
    reasons: conversionBlockers(spec, t),
  }));
}

function conversionBlockers(spec: MotionSpec, t: TransitionSpec): string[] {
  const reasons: string[] = [];
  const curves = [t.timing.curve, ...Object.values(t.targets).flatMap((g) => Object.values(g).map((x) => x.curve))];
  const retargets = t.interruptions.some((r) => r.policy === 'retarget') || t.interruptions.length === 0;
  if (retargets && curves.some((c) => c.type === 'spring')) {
    reasons.push('A retarget carries speed into a new spring. CSS and Web Animations cannot start from a speed.');
  }
  if (t.interruptions.some((r) => r.policy === 'queue')) {
    reasons.push('A queued command must start at an exact settle time. That needs the evaluator.');
  }
  const measured = Object.entries(spec.targets).filter(([, target]) => target.bounds !== 'translate');
  if (measured.length > 0) {
    reasons.push(`Measured bounds on ${measured.map(([id]) => id).join(', ')} depend on the viewport and on content.`);
  }
  return reasons;
}

function kebab(id: string) {
  return id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function configSource(spec: MotionSpec) {
  return [
    `// Written by Frame for ${spec.component.id} ${spec.component.version}. Edit it in Frame, or by hand.`,
    `import type { MotionSpec } from './runtime/spec';`,
    ``,
    `export const motion: MotionSpec = ${JSON.stringify(spec, null, 2)};`,
    ``,
  ].join('\n');
}

function usageSource(spec: MotionSpec) {
  const commands = spec.commands.map((c) => `'${c}'`).join(', ');
  const firstTarget = Object.keys(spec.targets)[0];
  return `// A minimal example. Replace the markup with your component.
'use client';

import { useFrame } from './runtime';
import { motion } from './motion.config';
import './frame.css';

export function Example() {
  // frame.state is one of: ${Object.keys(spec.states).join(', ')}
  // frame.send takes one of: ${commands}
  const frame = useFrame(motion);

  return (
    <section {...frame.root()}>
      {/* Spread frame.target(id) on each of: ${Object.keys(spec.targets).join(', ')} */}
      <div {...frame.target('${firstTarget}')} />
    </section>
  );
}
`;
}

function readmeSource(spec: MotionSpec) {
  return `# ${spec.component.id} motion

Exported by Frame for version ${spec.component.version} of the component.

Copy this folder into your source tree, for example \`src/motion/\`. There is nothing to install
except React 18.3 or 19. It needs a bundler that compiles TypeScript, such as Vite or Next.js.

\`\`\`tsx
import { useFrame } from './motion/runtime';
import { motion } from './motion/motion.config';
import './motion/frame.css';

const frame = useFrame(motion);
\`\`\`

See \`usage.example.tsx\`. Every rule in \`frame.css\` is scoped to \`data-frame\` attributes.

In Next.js, use it from a client component. The runtime reads no DOM during server rendering.

To remove it, delete this folder and the spreads of \`frame.root()\` and \`frame.target()\`.
`;
}

export function buildExport(
  spec: MotionSpec,
  runtime: Record<string, string>,
  css: string,
  meta: { tool: string },
): ExportFile[] {
  const files: ExportFile[] = [
    { path: 'motion.config.ts', content: configSource(spec) },
    { path: 'frame.css', content: css },
    { path: 'usage.example.tsx', content: usageSource(spec) },
    { path: 'README.md', content: readmeSource(spec) },
  ];
  for (const name of RUNTIME_FILES) {
    const content = runtime[name];
    if (content === undefined) throw new Error(`The runtime file ${name} is missing from this build.`);
    files.push({ path: `runtime/${name}`, content });
  }
  files.push({
    path: 'frame-export.json',
    content: `${JSON.stringify(
      {
        tool: meta.tool,
        name: kebab(spec.component.id),
        component: spec.component,
        formatVersion: spec.version,
        runtimeDependencies: { react: '>=18.3.0 <20' },
        conversions: reportConversions(spec),
      },
      null,
      2,
    )}\n`,
  });
  return files;
}
