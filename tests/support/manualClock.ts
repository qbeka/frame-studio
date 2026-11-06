/**
 * A clock that moves only when told. It lets two separate pages be compared at identical times,
 * without either one depending on the spacing of real frames. Test harness only.
 */
export interface ManualClock {
  now(): number;
  requestFrame(callback: () => void): () => void;
  advanceTo(t: number): void;
}

export function createManualClock(): ManualClock {
  let time = 0;
  let waiting: (() => void)[] = [];
  return {
    now: () => time,
    requestFrame(callback) {
      waiting.push(callback);
      return () => {
        waiting = waiting.filter((c) => c !== callback);
      };
    },
    advanceTo(t) {
      time = t;
      const run = waiting;
      waiting = [];
      for (const callback of run) callback();
    },
  };
}
