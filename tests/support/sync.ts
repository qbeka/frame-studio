import type { Page } from '@playwright/test';

/**
 * Drives a page on a manual clock and reads real geometry. Two pages given the same script are
 * compared at identical times, so disagreement cannot come from frame timing.
 */
export interface Step {
  atMs: number;
  /** Clicks the element with this accessible text. */
  click?: string;
  /** Sets the root's parent width in pixels, to force a layout change. */
  width?: number;
}

export interface TargetReading {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  clip: number[] | null;
}

export type Reading = { atMs: number; targets: Record<string, TargetReading> };

export function sampleTimes(endMs: number, stepMs: number, seed: number) {
  // Seeded jitter, so samples do not all land on a tidy grid.
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const times: number[] = [];
  for (let t = stepMs; t < endMs; t += stepMs) times.push(Math.round((t + random() * stepMs * 0.5) * 1000) / 1000);
  return times;
}

export async function runScript(page: Page, scope: string, steps: Step[], times: number[]): Promise<Reading[]> {
  return page.evaluate(
    async ({ scope, steps, times }) => {
      const clock = (window as any).__frameClock;
      const host = document.querySelector(scope) as HTMLElement;
      const root = host.querySelector('[data-frame-root]') as HTMLElement;
      const settle = () => new Promise((r) => setTimeout(r, 0));
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

      function read(atMs: number) {
        const origin = root.getBoundingClientRect();
        const targets: Record<string, unknown> = {};
        for (const el of root.querySelectorAll<HTMLElement>('[data-frame-target]')) {
          const style = getComputedStyle(el);
          if (style.display === 'none') continue;
          const box = el.getBoundingClientRect();
          const clip = style.clipPath === 'none' ? null : (style.clipPath.match(/-?[\d.]+/g) ?? []).map(Number);
          targets[el.dataset.frameTarget!] = {
            x: box.left - origin.left,
            y: box.top - origin.top,
            width: box.width,
            height: box.height,
            opacity: Number(style.opacity),
            clip,
          };
        }
        return { atMs, targets };
      }

      const events = [...steps.map((s) => ({ ...s, step: true })), ...times.map((atMs) => ({ atMs, step: false }))].sort(
        (a, b) => a.atMs - b.atMs || Number(b.step) - Number(a.step),
      );
      const out: unknown[] = [];
      for (const event of events as any[]) {
        clock.advanceTo(event.atMs);
        await settle();
        if (event.click) {
          const el = [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent!.trim() === event.click);
          if (!el) throw new Error(`No button "${event.click}" at ${event.atMs}`);
          el.click();
          await settle();
        } else if (event.width) {
          root.parentElement!.style.width = `${event.width}px`;
          // ResizeObserver delivers on the next frame. The clock is frozen, so the time is exact.
          await frame();
          await frame();
        } else if (!event.step) {
          out.push(read(event.atMs));
        }
      }
      return out;
    },
    { scope, steps, times },
  ) as Promise<Reading[]>;
}

export interface Disagreement {
  geometryPx: number;
  opacity: number;
  clipPx: number;
  compared: number;
  worstAt: { atMs: number; target: string; field: string } | null;
  missing: string[];
}

export function compare(a: Reading[], b: Reading[]): Disagreement {
  let geometryPx = 0;
  let opacity = 0;
  let clipPx = 0;
  let compared = 0;
  let worstAt: Disagreement['worstAt'] = null;
  const missing: string[] = [];
  a.forEach((sample, i) => {
    const other = b[i]!;
    const ids = new Set([...Object.keys(sample.targets), ...Object.keys(other.targets)]);
    for (const id of ids) {
      const p = sample.targets[id];
      const q = other.targets[id];
      if (!p || !q) {
        missing.push(`${id} at ${sample.atMs}`);
        continue;
      }
      compared += 1;
      for (const field of ['x', 'y', 'width', 'height'] as const) {
        const d = Math.abs(p[field] - q[field]);
        if (d > geometryPx) {
          geometryPx = d;
          worstAt = { atMs: sample.atMs, target: id, field };
        }
      }
      opacity = Math.max(opacity, Math.abs(p.opacity - q.opacity));
      if ((p.clip === null) !== (q.clip === null)) clipPx = Math.max(clipPx, Infinity);
      else if (p.clip && q.clip) p.clip.forEach((v, j) => (clipPx = Math.max(clipPx, Math.abs(v - (q.clip![j] ?? 0)))));
    }
  });
  return { geometryPx, opacity, clipPx, compared, worstAt, missing };
}
