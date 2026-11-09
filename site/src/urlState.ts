import type { MotionSpec, SpringCurve } from '../../packages/studio/runtime/spec';
import { DAMPING, RULES, STIFFNESS, curveOf, policyOf, tidy, withCurve, withPolicy, type CurveId, type Policy } from './motion';
import { SHOWCASES, showcaseById, type Showcase } from './showcase';

/**
 * What a link restores: the component, its three springs, the interruption rule and when the
 * interruption lands. Only values that differ from the defaults are written, so a plain visit
 * keeps a plain address.
 */
export interface Link {
  showcase: Showcase;
  spec: MotionSpec;
  delayMs: number;
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

export function readLink(search: string, only?: Showcase): Link {
  const params = new URLSearchParams(search);
  const showcase = only ?? showcaseById(params.get('c'));
  if (only && params.get('c') !== null && params.get('c') !== only.id) return { showcase, spec: showcase.spec, delayMs: showcase.exampleDelayMs };
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
  const delayMs = Math.round(number(params, 'at', DELAY.min, DELAY.max) ?? showcase.exampleDelayMs);
  return { showcase, spec, delayMs };
}

export function writeLink(showcase: Showcase, spec: MotionSpec, delayMs: number | null): string {
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
  if (delayMs !== null && Math.round(delayMs) !== showcase.exampleDelayMs) params.set('at', String(clampDelay(delayMs)));
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

const clampDelay = (value: number) => Math.max(DELAY.min, Math.min(DELAY.max, Math.round(value)));
