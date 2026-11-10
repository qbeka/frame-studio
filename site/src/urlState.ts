import type { MotionSpec, SpringCurve } from '../../packages/studio/runtime/spec';
import { LIBRARY, libraryById, type LibraryTake, type TakeContext } from './library';
import { DAMPING, RULES, STIFFNESS, curveOf, policyOf, tidy, withCurve, withPolicy, type CurveId, type Policy } from './motion';
import type { Take, TakeItem } from './session';
import { SHOWCASES, showcaseById, type Showcase } from './showcase';
import { decodeTake, encodeTake } from './takeCode';

/**
 * What a link restores: the component, its three springs, the interruption rule and the take.
 * Only values that differ from the defaults are written, so a plain visit keeps a plain address.
 * A take is one of three things: the page's first example with its interruption moved (`at`),
 * another example by name (`take`), or the visitor's own, written out in full (`t`).
 */
export interface TakeSource {
  initialState: string;
  scripted: boolean;
  name: string | null;
  /** Hand examples are written against the motion, so they are built once the layout is known. */
  build(context: TakeContext): TakeItem[];
}

export interface Link {
  showcase: Showcase;
  spec: MotionSpec;
  take: TakeSource;
}

const KEYS: Record<CurveId, [string, string]> = { go: ['k', 'd'], back: ['bk', 'bd'], interrupt: ['ik', 'id'] };
const CURVES = Object.keys(KEYS) as CurveId[];
const DELAY = { min: 10, max: 2000 };

function number(params: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export const fromLibrary = (showcase: Showcase, take: LibraryTake): TakeSource => ({
  initialState: showcase.spec.initialState,
  scripted: true,
  name: take.id,
  build: (context) => take.build(showcase, context),
});

/** The first example, with its interruption wherever the link or the visitor put it. */
export const exampleAt = (showcase: Showcase, delayMs: number): TakeSource => ({
  initialState: showcase.spec.initialState,
  scripted: true,
  name: LIBRARY[0]!.id,
  build: () => [
    { atMs: 0, type: 'command', command: showcase.go },
    { atMs: delayMs, type: 'command', command: showcase.back },
  ],
});

export const defaultTake = (showcase: Showcase) => exampleAt(showcase, showcase.exampleDelayMs);

export function readLink(search: string, only?: Showcase): Link {
  const params = new URLSearchParams(search);
  const showcase = only ?? showcaseById(params.get('c'));
  if (only && params.get('c') !== null && params.get('c') !== only.id) return { showcase, spec: showcase.spec, take: defaultTake(showcase) };
  let spec = showcase.spec;
  for (const id of CURVES) {
    const base = curveOf(spec, showcase, id);
    const stiffness = number(params, KEYS[id][0], STIFFNESS.min, STIFFNESS.max);
    const damping = number(params, KEYS[id][1], DAMPING.min, DAMPING.max);
    if (stiffness === null && damping === null) continue;
    const next: SpringCurve = tidy({ ...base, stiffness: stiffness ?? base.stiffness, damping: damping ?? base.damping });
    spec = withCurve(spec, showcase, id, next);
  }
  const rule = params.get('r');
  if (RULES.some((item) => item.policy === rule)) spec = withPolicy(spec, showcase, rule as Policy);

  const own = params.get('t');
  const decoded = own === null ? null : decodeTake(own, Object.keys(showcase.spec.states), showcase.spec.commands);
  if (decoded) return { showcase, spec, take: { initialState: decoded.initialState, scripted: false, name: null, build: () => decoded.events } };
  const named = libraryById(params.get('take'));
  if (named && named !== LIBRARY[0]) return { showcase, spec, take: fromLibrary(showcase, named) };
  const delayMs = Math.round(number(params, 'at', DELAY.min, DELAY.max) ?? showcase.exampleDelayMs);
  return { showcase, spec, take: exampleAt(showcase, delayMs) };
}

/** The address for what is on screen. `held` is false when the take is too long to write down. */
export function writeLink(showcase: Showcase, spec: MotionSpec, take: Take | null): { query: string; held: boolean } {
  const params = new URLSearchParams();
  if (showcase !== SHOWCASES[0]) params.set('c', showcase.id);
  for (const id of CURVES) {
    const base = curveOf(showcase.spec, showcase, id);
    const now = curveOf(spec, showcase, id);
    if (now.stiffness !== base.stiffness) params.set(KEYS[id][0], String(now.stiffness));
    if (now.damping !== base.damping) params.set(KEYS[id][1], String(now.damping));
  }
  const policy = policyOf(spec, showcase);
  if (policy !== policyOf(showcase.spec, showcase)) params.set('r', policy);

  let held = true;
  if (take && take.events.length > 0) {
    const first = take.events[0]!.atMs;
    if (take.name === LIBRARY[0]!.id) {
      const delayMs = take.events.length > 1 ? take.events[1]!.atMs - first : null;
      if (delayMs !== null && Math.round(delayMs) !== showcase.exampleDelayMs) params.set('at', String(clampDelay(delayMs)));
    } else if (take.name !== null) {
      params.set('take', take.name);
    } else {
      const events = take.events.map((event) => ({ ...event, atMs: event.atMs - first }));
      const code = encodeTake({ initialState: take.initialState, events }, Object.keys(showcase.spec.states), showcase.spec.commands);
      if (code) params.set('t', code);
      else held = false;
    }
  }
  const query = params.toString();
  return { query: query === '' ? '' : `?${query}`, held };
}

const clampDelay = (value: number) => Math.max(DELAY.min, Math.min(DELAY.max, Math.round(value)));
