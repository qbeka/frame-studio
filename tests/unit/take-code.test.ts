import { describe, expect, it } from 'vitest';
import { LIBRARY } from '../../site/src/library';
import type { TakeItem } from '../../site/src/session';
import { MAX_CODE_LENGTH, decodeTake, encodeTake } from '../../site/src/takeCode';

const STATES = ['compact', 'editing', 'confirmation'];
const COMMANDS = ['open', 'cancel', 'submit'];

/** A take the way the page records one: times on a quarter millisecond, progress on 1/4096. */
const thrown: TakeItem[] = [
  { atMs: 0, type: 'grab', command: 'open', progress: 0 },
  { atMs: 8.25, type: 'drag', progress: 37 / 4096 },
  { atMs: 16.5, type: 'drag', progress: 410 / 4096 },
  { atMs: 24.75, type: 'drag', progress: 1300 / 4096 },
  { atMs: 33, type: 'drag', progress: 4400 / 4096 },
  { atMs: 41.25, type: 'drag', progress: 4096 / 4096 },
  { atMs: 44, type: 'release' },
  { atMs: 180.5, type: 'grab', command: 'cancel', progress: -80 / 4096 },
  { atMs: 190.75, type: 'drag', progress: 900 / 4096 },
  { atMs: 2190.75, type: 'drag', progress: 905 / 4096 },
  { atMs: 2200, type: 'command', command: 'open' },
  { atMs: 2600, type: 'command', command: 'cancel' },
];

describe('a take in the address', () => {
  it('comes back exactly as it went in', () => {
    const code = encodeTake({ initialState: 'compact', events: thrown }, STATES, COMMANDS)!;
    expect(code).toMatch(/^[0-9a-zA-Z_-]+$/);
    expect(decodeTake(code, STATES, COMMANDS)).toEqual({ initialState: 'compact', events: thrown });
  });

  it('keeps the state a take began in', () => {
    const events: TakeItem[] = [{ atMs: 0, type: 'command', command: 'cancel' }];
    const code = encodeTake({ initialState: 'editing', events }, STATES, COMMANDS)!;
    expect(decodeTake(code, STATES, COMMANDS)).toEqual({ initialState: 'editing', events });
  });

  it('counts time from the first event, wherever the take began', () => {
    const later = thrown.map((event) => ({ ...event, atMs: event.atMs + 1234.5 }));
    expect(encodeTake({ initialState: 'compact', events: later }, STATES, COMMANDS)).toBe(encodeTake({ initialState: 'compact', events: thrown }, STATES, COMMANDS));
  });

  it('spends about four characters on a pointer sample', () => {
    const events: TakeItem[] = [{ atMs: 0, type: 'grab', command: 'open', progress: 0 }];
    for (let i = 1; i <= 100; i += 1) events.push({ atMs: i * 8, type: 'drag', progress: Math.round((i / 100) ** 2 * 4096) / 4096 });
    events.push({ atMs: 804, type: 'release' });
    const code = encodeTake({ initialState: 'compact', events }, STATES, COMMANDS)!;
    expect(code.length).toBeLessThan(100 * 4.2 + 12);
    expect(decodeTake(code, STATES, COMMANDS)!.events).toEqual(events);
  });

  it('gives up on a take too long to paste, and on one it cannot write', () => {
    const events: TakeItem[] = [{ atMs: 0, type: 'grab', command: 'open', progress: 0 }];
    for (let i = 1; i <= 900; i += 1) events.push({ atMs: i * 8, type: 'drag', progress: (i % 97) / 100 });
    expect(encodeTake({ initialState: 'compact', events }, STATES, COMMANDS)).toBeNull();
    expect(encodeTake({ initialState: 'nowhere', events: thrown }, STATES, COMMANDS)).toBeNull();
    expect(encodeTake({ initialState: 'compact', events: [{ atMs: 0, type: 'command', command: 'fly' }] }, STATES, COMMANDS)).toBeNull();
    expect(encodeTake({ initialState: 'compact', events: [{ atMs: 0, type: 'drag', progress: 0.5 }] }, STATES, COMMANDS)).toBeNull();
    expect(encodeTake({ initialState: 'compact', events: [] }, STATES, COMMANDS)).toBeNull();
  });

  it('reads nonsense as no take at all', () => {
    const code = encodeTake({ initialState: 'compact', events: thrown }, STATES, COMMANDS)!;
    for (const bad of ['', ' ', 'zz zz', '!!', code.slice(0, -3), `9${code.slice(1)}`, 'x'.repeat(MAX_CODE_LENGTH + 1)]) {
      expect(decodeTake(bad, STATES, COMMANDS)).toBeNull();
    }
    // A command this component does not have, and a state it does not have.
    expect(decodeTake(code, STATES, ['open'])).toBeNull();
    expect(decodeTake(encodeTake({ initialState: 'confirmation', events: thrown }, STATES, COMMANDS)!, ['compact'], COMMANDS)).toBeNull();
  });

  it('refuses a hand that is nowhere near the transition', () => {
    const wild = encodeTake({ initialState: 'compact', events: [{ atMs: 0, type: 'grab', command: 'open', progress: 30 }] }, STATES, COMMANDS)!;
    expect(decodeTake(wild, STATES, COMMANDS)).toBeNull();
  });
});

describe('the example takes', () => {
  const showcase = { go: 'open', back: 'cancel', exampleDelayMs: 110 } as never;
  const context = { progressAt: () => 0.25 };

  it('start at zero, run forwards and sit on the grid a link can hold', () => {
    for (const take of LIBRARY) {
      const events = take.build(showcase, context);
      expect(events[0]!.atMs).toBe(0);
      for (let i = 1; i < events.length; i += 1) expect(events[i]!.atMs).toBeGreaterThanOrEqual(events[i - 1]!.atMs);
      const code = encodeTake({ initialState: 'compact', events }, STATES, COMMANDS)!;
      expect(decodeTake(code, STATES, COMMANDS)!.events).toEqual(events);
    }
  });

  it('send a hand as samples eight milliseconds apart, and none while it is still', () => {
    const slow = LIBRARY.find((take) => take.id === 'slow-pull')!.build(showcase, context);
    const drags = slow.filter((event) => event.type === 'drag');
    expect(drags.length).toBe(65);
    drags.forEach((drag, i) => expect(drag.atMs).toBe((i + 1) * 8));
    // The hand stops at 520 ms and lets go at 800, with nothing sent in between.
    expect(slow[slow.length - 1]).toEqual({ atMs: 800, type: 'command', command: 'cancel' });
  });

  it('catch wherever the motion has carried the component', () => {
    const asked: number[] = [];
    const events = LIBRARY.find((take) => take.id === 'throw-and-catch')!.build(showcase, {
      progressAt(soFar, atMs, command) {
        asked.push(atMs);
        expect(command).toBe('cancel');
        expect(soFar[soFar.length - 1]).toEqual({ atMs: 148, type: 'release' });
        return 0.125;
      },
    });
    expect(asked).toEqual([300]);
    expect(events.find((event) => event.type === 'grab' && event.atMs === 300)).toMatchObject({ command: 'cancel', progress: 0.125 });
  });
});
