#!/usr/bin/env node
/**
 * Frame's command line.
 *   frame dev <registrations.tsx> [--port 5172]
 *   frame init <registrations.tsx> [--out component.frame.json]
 *   frame export <project.frame.json> [--out frame-export]
 *   frame validate <file.json>
 *   frame build-demo <registrations.tsx> --out dist/demo [--base /] [--with-try] [--try-for id]
 *
 * It is plain JavaScript with Vite as its only tool. Vite compiles the editor and your
 * registration file, and also loads the TypeScript authoring code for the commands that need it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    // Set by scripts/build-site.mjs, which puts a built export at ./try/. --try-for names the one
    // component that export was made from, when the demo registers more than one.
    define: {
      'import.meta.env.VITE_FRAME_TRY': JSON.stringify(args.includes('--with-try') ? '1' : ''),
      'import.meta.env.VITE_FRAME_TRY_FOR': JSON.stringify(argument(args, 'try-for', '')),
    },
    base: argument(args, 'base', './'),
    logLevel: 'warn',
    build: { outDir: resolve(argument(args, 'out', 'dist/demo')), emptyOutDir: true },
  });
}

/** Loads the TypeScript authoring code. No HTTP port is opened. */
async function loadAuthoring(extraRoot) {
  const server = await createServer({
    configFile: false,
    root: packageRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false, fs: { allow: [packageRoot, process.cwd(), extraRoot ?? packageRoot] } },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom',
  });
  const authoring = await server.ssrLoadModule('/authoring/index.ts');
  return { authoring, server, close: () => server.close() };
}

function printProblems(problems) {
  for (const { path, message } of problems) console.error(`  ${path}: ${message}`);
}

async function validate(args) {
  const file = resolve(args[0] ?? fail('Pass a .frame.json project or a motion spec.'));
  const { authoring, close } = await loadAuthoring();
  const result = authoring.parseAnyDocument(readProjectFile(file));
  await close();
  if (!result.ok) {
    console.error(`${file} is not valid:`);
    printProblems(result.problems);
    process.exit(1);
  }
  console.log(`${file} is valid.`);
}

/** Writes a starter project for the first registration in a file. */
async function init(args) {
  const file = resolve(args[0] ?? fail('Pass your registrations file.'));
  const { authoring, server, close } = await loadAuthoring(dirname(file));
  const { default: registrations } = await server.ssrLoadModule(file);
  const registration = registrations[0] ?? fail('That file exports no registrations.');
  const out = resolve(argument(args, 'out', `${registration.id.replace(/[^a-z0-9]+/gi, '-')}.frame.json`));
  const project = {
    format: authoring.PROJECT_FORMAT,
    version: authoring.PROJECT_VERSION,
    name: registration.id,
    spec: authoring.createStarterSpec(registration),
    take: null,
  };
  writeFileSync(out, authoring.serializeProject(project));
  await close();
  console.log(`Wrote ${out}`);
}

async function exportProject(args) {
  const file = resolve(args[0] ?? fail('Pass a .frame.json project.'));
  const out = resolve(argument(args, 'out', 'frame-export'));
  const { authoring, close } = await loadAuthoring();
  const result = authoring.parseAnyDocument(readProjectFile(file));
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

/** Reads a JSON document, and explains the usual mistakes without a stack trace. */
function readProjectFile(file) {
  if (!existsSync(file)) fail(`Could not find ${file}.`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fail(`${file} is not JSON. Pass a .frame.json project, not a registrations file.`);
  }
}

const [command, ...args] = process.argv.slice(2);
const commands = { dev, init, export: exportProject, validate, 'build-demo': buildDemo };
if (!commands[command]) {
  fail(`Usage:
  frame dev <registrations.tsx> [--port 5172]     Open the studio
  frame init <registrations.tsx> [--out file]     Write a starter project
  frame export <project.frame.json> [--out dir]   Write the runtime and config
  frame validate <file.json>                      Check a project or spec
  frame build-demo <registrations.tsx> --out dir  Build a static demo`);
}
await commands[command](args);
