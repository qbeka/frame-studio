import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, createZip, reportConversions, RUNTIME_FILES } from 'frame-studio/authoring';
import type { MotionSpec } from 'frame-studio/pure';

const runtimeDir = new URL('../../packages/studio/runtime/', import.meta.url).pathname;
const read = (name: string) => readFileSync(join(runtimeDir, name), 'utf8');
const project = JSON.parse(readFileSync(new URL('../../fixtures/inspector/inspector.frame.json', import.meta.url), 'utf8'));

function imports(source: string) {
  return [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
}

describe('the runtime stays independent', () => {
  const files = readdirSync(runtimeDir).filter((f) => f.endsWith('.ts'));

  it('imports only itself and React', () => {
    for (const file of files) {
      for (const specifier of imports(read(file))) {
        expect(specifier === 'react' || specifier.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('keeps the pure core free of the DOM and of React', () => {
    for (const file of ['spec.ts', 'spring.ts', 'tween.ts', 'channel.ts', 'timeline.ts']) {
      const source = read(file);
      expect(imports(source)).not.toContain('react');
      expect(source, file).not.toMatch(/\b(document|window|requestAnimationFrame|performance)\./);
    }
  });

  it('has no Fiber or React internals anywhere', () => {
    const everything = files.map(read).join('\n');
    expect(everything).not.toMatch(/__reactFiber|__reactInternal|_owner|__SECRET_INTERNALS|memoizedProps/);
  });
});

describe('export', () => {
  const runtime = Object.fromEntries(RUNTIME_FILES.map((n) => [n, read(n)]));
  const build = (spec: MotionSpec) => buildExport(spec, runtime, read('frame.css'), { tool: 'test' });

  it('is deterministic', () => {
    expect(build(project.spec)).toEqual(build(structuredClone(project.spec)));
    const zip = (files: ReturnType<typeof build>) => createZip(files);
    expect(zip(build(project.spec))).toEqual(zip(build(project.spec)));
  });

  it('writes the runtime exactly as tested, with no editor code', () => {
    const files = build(project.spec);
    for (const name of RUNTIME_FILES) expect(files.find((f) => f.path === `runtime/${name}`)!.content).toBe(runtime[name]);
    expect(files.map((f) => f.path).join()).not.toMatch(/editor|authoring|pure/);
  });

  it('refuses to build with a runtime file missing', () => {
    const { 'spring.ts': _, ...partial } = runtime;
    expect(() => buildExport(project.spec, partial, '', { tool: 'test' })).toThrow(/spring.ts/);
  });

  it('says why a spring with a retarget cannot become CSS', () => {
    expect(reportConversions(project.spec)[0]!.reasons.join(' ')).toMatch(/cannot start from a speed/);
  });

  it('keeps every CSS rule scoped to data-frame attributes', () => {
    const selectors = read('frame.css').replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)!;
    for (const selector of selectors) expect(selector).toContain('[data-frame-');
  });
});
