import type { Curve } from '../../runtime/spec';

export const PRESETS: { name: string; curve: Curve }[] = [
  { name: 'Quiet', curve: { type: 'spring', stiffness: 420, damping: 34, mass: 1 } },
  { name: 'Firm', curve: { type: 'spring', stiffness: 700, damping: 48, mass: 1 } },
  { name: 'Soft', curve: { type: 'spring', stiffness: 170, damping: 24, mass: 1 } },
  { name: 'Lively', curve: { type: 'spring', stiffness: 520, damping: 20, mass: 1 } },
  { name: 'Timed', curve: { type: 'tween', durationMs: 220, easing: [0.2, 0, 0, 1] } },
];
