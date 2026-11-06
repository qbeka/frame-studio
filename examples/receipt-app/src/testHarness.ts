import type { FrameOptions } from './motion/runtime';
import { createManualClock } from './manualClock';

/** Opt in with ?clock=manual. This is the browser test's hook, not part of the export. */
export function testOptions(): FrameOptions {
  if (new URLSearchParams(location.search).get('clock') !== 'manual') return {};
  const clock = createManualClock();
  (window as unknown as { __frameClock: unknown }).__frameClock = clock;
  return { clock };
}
