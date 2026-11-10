import type { TakeItem } from './session';

/**
 * A take as a short string for the address bar. Times are counted in quarter milliseconds from
 * the event before, and a hand's progress in steps of 1/4096 from its sample before, so most
 * numbers fit in one or two characters. The page only ever records on that grid, which is why a
 * link gives back exactly the take it was made from.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const VERSION = 1;
const TIME_GRID = 4;
const PROGRESS_GRID = 4096;
/** Longer than this and the address stops being something to paste. */
export const MAX_CODE_LENGTH = 1800;
const MAX_EVENTS = 4000;

const COMMAND = 0;
const GRAB = 1;
const RELEASE = 2;

function writer() {
  let out = '';
  const unsigned = (value: number) => {
    let rest = Math.max(0, Math.round(value));
    do {
      const low = rest % 32;
      rest = Math.floor(rest / 32);
      out += ALPHABET[low + (rest > 0 ? 32 : 0)];
    } while (rest > 0);
  };
  return {
    unsigned,
    signed: (value: number) => unsigned(value < 0 ? -2 * value - 1 : 2 * value),
    text: () => out,
  };
}

function reader(text: string) {
  let at = 0;
  const unsigned = () => {
    let value = 0;
    let scale = 1;
    for (;;) {
      const symbol = ALPHABET.indexOf(text[at] ?? '\n');
      if (symbol < 0) throw new Error('The take ends early.');
      at += 1;
      value += (symbol % 32) * scale;
      if (symbol < 32) return value;
      scale *= 32;
      if (scale > 2 ** 40) throw new Error('A number in the take is too long.');
    }
  };
  return {
    unsigned,
    signed: () => {
      const value = unsigned();
      return value % 2 ? -(value + 1) / 2 : value / 2;
    },
    done: () => at >= text.length,
  };
}

export interface CodedTake {
  initialState: string;
  /** Times count from the first event. */
  events: TakeItem[];
}

export function encodeTake(take: CodedTake, states: string[], commands: string[]): string | null {
  const w = writer();
  const state = states.indexOf(take.initialState);
  if (state < 0 || take.events.length === 0) return null;
  w.unsigned(VERSION);
  w.unsigned(state);
  let clock = Math.round(take.events[0]!.atMs * TIME_GRID);
  const tick = (atMs: number) => {
    const now = Math.round(atMs * TIME_GRID);
    w.unsigned(now - clock);
    clock = now;
  };
  for (let i = 0; i < take.events.length; i += 1) {
    const event = take.events[i]!;
    if (event.type === 'command') {
      const index = commands.indexOf(event.command);
      if (index < 0) return null;
      w.unsigned(COMMAND);
      w.unsigned(index);
      tick(event.atMs);
    } else if (event.type === 'grab') {
      const index = commands.indexOf(event.command);
      if (index < 0) return null;
      let end = i + 1;
      while (take.events[end]?.type === 'drag') end += 1;
      w.unsigned(GRAB);
      w.unsigned(index);
      tick(event.atMs);
      let place = Math.round(event.progress * PROGRESS_GRID);
      w.signed(place);
      w.unsigned(end - i - 1);
      for (let j = i + 1; j < end; j += 1) {
        const drag = take.events[j] as Extract<TakeItem, { type: 'drag' }>;
        tick(drag.atMs);
        const next = Math.round(drag.progress * PROGRESS_GRID);
        w.signed(next - place);
        place = next;
      }
      i = end - 1;
    } else if (event.type === 'release') {
      w.unsigned(RELEASE);
      tick(event.atMs);
    } else {
      // A drag with no hand before it cannot be recorded, so there is nothing to write.
      return null;
    }
  }
  const text = w.text();
  return text.length > MAX_CODE_LENGTH ? null : text;
}

export function decodeTake(text: string, states: string[], commands: string[]): CodedTake | null {
  if (text.length === 0 || text.length > MAX_CODE_LENGTH) return null;
  try {
    const r = reader(text);
    if (r.unsigned() !== VERSION) return null;
    const initialState = states[r.unsigned()];
    if (initialState === undefined) return null;
    const events: TakeItem[] = [];
    let clock = 0;
    const tick = () => {
      clock += r.unsigned();
      return clock / TIME_GRID;
    };
    const command = () => {
      const name = commands[r.unsigned()];
      if (name === undefined) throw new Error('The take names a command this component does not have.');
      return name;
    };
    const progress = (units: number) => {
      const value = units / PROGRESS_GRID;
      if (value < -1 || value > 2) throw new Error('A hand in the take is nowhere near the transition.');
      return value;
    };
    while (!r.done()) {
      if (events.length > MAX_EVENTS) return null;
      const kind = r.unsigned();
      if (kind === COMMAND) {
        const name = command();
        events.push({ atMs: tick(), type: 'command', command: name });
      } else if (kind === GRAB) {
        const name = command();
        const atMs = tick();
        let place = r.signed();
        events.push({ atMs, type: 'grab', command: name, progress: progress(place) });
        const count = r.unsigned();
        if (count > MAX_EVENTS) return null;
        for (let i = 0; i < count; i += 1) {
          const at = tick();
          place += r.signed();
          events.push({ atMs: at, type: 'drag', progress: progress(place) });
        }
      } else if (kind === RELEASE) {
        events.push({ atMs: tick(), type: 'release' });
      } else {
        return null;
      }
    }
    return events.length === 0 ? null : { initialState, events };
  } catch {
    return null;
  }
}
