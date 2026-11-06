#!/usr/bin/env node
/**
 * Frame's command line.
 *   frame dev <registrations.tsx> [--port 5172]
 *   frame export <project.frame.json> [--out frame-export]
 *   frame validate <file.json>
 *   frame build-demo <registrations.tsx> --out dist/demo [--base /]
 *
 * It is plain JavaScript with Vite as its only tool. Vite compiles the editor and your
 * registration file, and also loads the TypeScript authoring code for the commands that need it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import react from '@vitejs/plugin-react';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIRTUAL_ID = 'virtual:frame-registrations';

function argument(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

/** Maps the import the editor uses onto the file you passed. This is the whole plugin. */
function registrationsPlugin(file) {
  return {
    name: 'frame-registrations',
    resolveId: (id) => (id === VIRTUAL_ID ? file : null),
  };
}

function editorConfig(file) {
  return {
    configFile: false,
    root: join(packageRoot, 'editor'),
    plugins: [react(), registrationsPlugin(file)],
    resolve: { dedupe: ['react', 'react-dom'] },
  };
}

async function dev(args) {
  const file = resolve(args[0] ?? fail('Pass your registrations file.'));
  const port = Number(argument(args, 'port', 5172));
  const server = await createServer({
    ...editorConfig(file),
    server: { port, strictPort: true, fs: { allow: [packageRoot, process.cwd(), dirname(file)] } },
  });
  await server.listen();
  console.log(`Frame is running at http://localhost:${port}/`);
}

async function buildDemo(args) {
  const file = resolve(args[0] ?? fail('Pass your registrations file.'));
  await build({
    ...editorConfig(file),
    base: argument(args, 'base', './'),
    logLevel: 'warn',
    build: { outDir: resolve(argument(args, 'out', 'dist/demo')), emptyOutDir: true },
  });
}

/** Loads the TypeScript authoring code. No HTTP port is opened. */
async function loadAuthoring() {
  const server = await createServer({
    configFile: false,
    root: packageRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
  });
  const authoring = await server.ssrLoadModule('/authoring/index.ts');
  return { authoring, close: () => server.close() };
}

function printProblems(problems) {
  for (const { path, message } of problems) console.error(`  ${path}: ${message}`);
}

async function validate(args) {
  const file = resolve(args[0] ?? fail('Pass a .frame.json project or a motion spec.'));
  const { authoring, close } = await loadAuthoring();
  const result = authoring.parseAnyDocument(JSON.parse(readFileSync(file, 'utf8')));
  await close();
  if (!result.ok) {
    console.error(`${file} is not valid:`);
    printProblems(result.problems);
    process.exit(1);
  }
  console.log(`${file} is valid.`);
}

async function exportProject(args) {
  const file = resolve(args[0] ?? fail('Pass a .frame.json project.'));
  const out = resolve(argument(args, 'out', 'frame-export'));
  const { authoring, close } = await loadAuthoring();
  const result = authoring.parseAnyDocument(JSON.parse(readFileSync(file, 'utf8')));
  if (!result.ok) {
    await close();
    console.error(`${file} is not valid:`);
    printProblems(result.problems);
    process.exit(1);
  }
  const runtime = {};
  for (const name of authoring.RUNTIME_FILES) {
    runtime[name] = readFileSync(join(packageRoot, 'runtime', name), 'utf8');
  }
  const css = readFileSync(join(packageRoot, 'runtime', 'frame.css'), 'utf8');
  const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  const files = authoring.buildExport(result.value, runtime, css, { tool: `frame-studio ${version}` });
  await close();
  for (const { path, content } of files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), content);
  }
  console.log(`Wrote ${files.length} files to ${out}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const commands = { dev, export: exportProject, validate, 'build-demo': buildDemo };
if (!commands[command]) fail('Usage: frame dev|export|validate|build-demo');
await commands[command](args);
