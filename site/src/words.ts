import { isAnimating } from '../../packages/studio/runtime/timeline';
import { LIBRARY } from './library';
import { label } from './motion';
import { LEAD_MS, type Snapshot } from './session';
import type { Showcase } from './showcase';

const speed = (value: number) => `${Math.round(Math.abs(value)).toLocaleString('en-US')} px/s`;

/** One sentence about the take on the stage. No closing period: it is a status line. */
export function describe(snap: Snapshot, showcase: Showcase): string {
  const { take, steps, ghost, phase, moving, hands, held } = snap;
  const origin = snap.domain.start + LEAD_MS;
  const go = label(showcase, showcase.go);
  const back = label(showcase, showcase.back);
  const toward = (velocity: number) => showcase.registration.states[velocity * (snap.levels.high - snap.levels.low) >= 0 ? showcase.to : showcase.from]!.label;

  if (held) return 'Your hand has it now, and the spring gets the position and the speed when you let go';
  if (hands.length > 0) {
    const example = take.scripted ? LIBRARY.find((item) => item.id === take.name) : null;
    const last = hands[hands.length - 1]!;
    const thrown = Math.abs(last.speed) >= 300;
    const ended = thrown ? `let go at ${speed(last.speed)} toward ${toward(last.speed)}` : 'let go at rest';
    const lead = example ? `${example.name}, an example written as pointer samples` : hands.length === 1 ? 'One hold by hand' : `${hands.length} holds by hand`;
    return `${lead}, ${ended}, where the spring took over`;
  }

  if (take.scripted && steps[1]) {
    if (take.name && take.name !== LIBRARY[0]!.id) {
      const example = LIBRARY.find((item) => item.id === take.name);
      return `${example?.name ?? 'An example take'}, with ${take.events.length} presses and the last ${Math.round(take.events[take.events.length - 1]!.atMs - origin)} ms in`;
    }
    return `An example take, with ${back} landing ${Math.round(steps[1].atMs - origin)} ms into ${go}`;
  }
  // A queued command adds a step when it finally runs. This describes the press itself.
  const pressed = take.events[take.events.length - 1];
  const last = pressed?.type === 'command' ? steps.find((step) => step.atMs === pressed.atMs && step.command === pressed.command) : undefined;
  if (take.events.length > 1 && last) {
    const name = label(showcase, last.command);
    const ms = Math.round(last.atMs - origin);
    if (last.outcome === 'queue') return `${name} landed ${ms} ms in and waited for the motion to finish`;
    if (last.outcome === 'ignore') return `${name} landed ${ms} ms in and was ignored`;
    if (last.outcome === 'reject') return `${name} landed ${ms} ms in and had nothing to do`;
    if (ghost && isAnimating(ghost, last.atMs)) return `${name} landed ${ms} ms in and took over from the current position and speed`;
    return `${name} landed ${ms} ms in, after the motion had settled`;
  }
  if (last?.command === showcase.go) {
    if (moving && phase === 'live') return `${go} is running, so press ${back} before it settles`;
    return `${go} ran to the end, so press ${back} sooner, turn on Slow motion, or drag it by hand`;
  }
  if (last?.command === showcase.back) return `${back} landed after ${go} had settled, so there was nothing to interrupt`;
  return 'This take ran without an interruption';
}

/** The take in a few words, for the caption of its plate. */
export function caption(snap: Snapshot, showcase: Showcase): string {
  const { take, hands } = snap;
  const origin = snap.domain.start + LEAD_MS;
  const example = take.scripted ? LIBRARY.find((item) => item.id === take.name) : null;
  if (example && example !== LIBRARY[0]) return example.name;
  if (hands.length > 0) {
    const last = hands[hands.length - 1]!;
    const catches = hands.length === 1 ? 'Held once by hand' : `Held ${hands.length} times by hand`;
    return Math.abs(last.speed) >= 300 ? `${catches} and thrown at ${speed(last.speed)}` : `${catches} and let go at rest`;
  }
  const presses = take.events.filter((event) => event.type === 'command');
  if (presses.length === 2) return `${label(showcase, presses[1]!.command)} landing ${Math.round(presses[1]!.atMs - origin)} ms into ${label(showcase, presses[0]!.command)}`;
  if (presses.length === 1) return `${label(showcase, presses[0]!.command)}, uninterrupted`;
  return `${presses.length} presses in ${Math.round(presses[presses.length - 1]!.atMs - origin)} ms`;
}
