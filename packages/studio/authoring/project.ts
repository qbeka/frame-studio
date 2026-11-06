import type { MotionSpec, Rects } from '../runtime/spec';
import type { TakeEvent } from '../runtime/timeline';
import { parseMotionSpec, type ParseResult, type Problem } from './parse';
import type { PropValue } from './registration';

/**
 * A project file is the durable transfer format: the spec, plus what you need to carry on
 * working, which is the props and the current take. Browser storage only holds drafts.
 */
export const PROJECT_FORMAT = 'frame.project';
export const PROJECT_VERSION = 1;

export interface Take {
  startMs: number;
  /** State the take began in. It is not always the spec's initial state. */
  initialState: string;
  initialRects: Rects;
  initialProps: Record<string, PropValue>;
  events: TakeEvent[];
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  name: string;
  spec: MotionSpec;
  take: Take | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRects(value: unknown): value is Rects {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (r) =>
      isRecord(r) &&
      [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      (r.width as number) >= 0 &&
      (r.height as number) >= 0,
  );
}

function readTake(value: unknown, problems: Problem[]): Take | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.startMs !== 'number' ||
    !Number.isFinite(value.startMs) ||
    typeof value.initialState !== 'string' ||
    !isRects(value.initialRects) ||
    !isRecord(value.initialProps) ||
    !Array.isArray(value.events)
  ) {
    problems.push({ path: 'take', message: 'must be null, or a take with startMs, initialState, initialRects, initialProps and events.' });
    return null;
  }
  const events: TakeEvent[] = [];
  let previous = -Infinity;
  value.events.forEach((event: unknown, i: number) => {
    const path = `take.events[${i}]`;
    if (!isRecord(event) || typeof event.atMs !== 'number' || !Number.isFinite(event.atMs)) {
      problems.push({ path, message: 'needs a finite atMs in milliseconds.' });
      return;
    }
    if (event.atMs < previous) problems.push({ path, message: 'is out of order.' });
    previous = event.atMs;
    if (event.type === 'command' && typeof event.command === 'string') {
      if (event.reduced !== undefined && typeof event.reduced !== 'boolean') problems.push({ path: `${path}.reduced`, message: 'must be true or false.' });
      if (event.rects !== undefined && !isRects(event.rects)) problems.push({ path: `${path}.rects`, message: 'are not valid boxes.' });
      events.push(event as TakeEvent);
    } else if (event.type === 'measure' && isRects(event.rects)) {
      events.push(event as TakeEvent);
    } else if (event.type === 'props' && isRecord(event.patch)) {
      events.push(event as TakeEvent);
    } else {
      problems.push({ path, message: 'must be a command, measure or props event.' });
    }
  });
  return {
    startMs: value.startMs,
    initialState: value.initialState,
    initialRects: value.initialRects,
    initialProps: value.initialProps as Record<string, PropValue>,
    events,
  };
}

export function parseProject(input: unknown): ParseResult<Project> {
  if (!isRecord(input)) return { ok: false, problems: [{ path: 'project', message: 'must be a JSON object.' }] };
  if (input.format !== PROJECT_FORMAT) {
    return { ok: false, problems: [{ path: 'format', message: `must be "${PROJECT_FORMAT}", got ${JSON.stringify(input.format)}` }] };
  }
  if (input.version !== PROJECT_VERSION) {
    return { ok: false, problems: [{ path: 'version', message: `This build reads project format ${PROJECT_VERSION}, got ${JSON.stringify(input.version)}` }] };
  }
  const parsed = parseMotionSpec(input.spec);
  if (!parsed.ok) return { ok: false, problems: parsed.problems.map((p) => ({ ...p, path: `spec.${p.path}` })) };
  const problems: Problem[] = [];
  if (typeof input.name !== 'string' || input.name === '') problems.push({ path: 'name', message: 'must be a non-empty string.' });
  const take = readTake(input.take, problems);
  if (take && !Object.hasOwn(parsed.value.states, take.initialState)) {
    problems.push({ path: 'take.initialState', message: `no state named "${take.initialState}"` });
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    migratedFrom: parsed.migratedFrom,
    value: { format: PROJECT_FORMAT, version: PROJECT_VERSION, name: input.name as string, spec: parsed.value, take },
  };
}

/** Takes a project or a bare motion spec, which is what `frame validate` and `export` accept. */
export function parseAnyDocument(input: unknown): ParseResult<MotionSpec> {
  if (isRecord(input) && input.format === PROJECT_FORMAT) {
    const project = parseProject(input);
    return project.ok ? { ...project, value: project.value.spec } : project;
  }
  return parseMotionSpec(input);
}

export function serializeProject(project: Project) {
  return `${JSON.stringify(project, null, 2)}\n`;
}
