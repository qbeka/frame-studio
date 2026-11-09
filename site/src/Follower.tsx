import { useLayoutEffect, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { PropValue } from '../../packages/studio/authoring/registration';
import { createController } from '../../packages/studio/runtime/controller';
import { useFrameController } from '../../packages/studio/runtime/react';
import type { MotionSpec } from '../../packages/studio/runtime/spec';
import type { Session, Take } from './session';
import type { Showcase } from './showcase';

const noop = () => {};

/** Steps by hand, so a second copy of the component stays on the same frame as the take beside it. */
function createFollowClock() {
  let time = 0;
  let waiting: (() => void) | null = null;
  return {
    now: () => time,
    set(t: number) {
      time = t;
    },
    requestFrame(callback: () => void) {
      waiting = callback;
      return () => {
        waiting = null;
      };
    },
    advanceTo(t: number) {
      time = t;
      const run = waiting;
      waiting = null;
      run?.();
    },
  };
}

/**
 * A second, separate copy of the component under its own spec, with no history and no seeking.
 * It gets the take's commands at their recorded times and works out everything else for itself,
 * from its own measured layout. The race and the export preview are both this.
 */
export function Follower({
  spec,
  showcase,
  session,
  take,
  props,
}: {
  spec: MotionSpec;
  showcase: Showcase;
  session: Session;
  take: Take;
  props: Record<string, PropValue>;
}) {
  const clock = useMemo(createFollowClock, []);
  const controller = useMemo(() => createController(spec, { clock }), [spec, clock]);
  const frame = useFrameController(controller, spec);
  const latest = useRef(take);
  latest.current = take;

  useLayoutEffect(() => {
    let ran: Take | null = null;
    let sent = 0;
    let last = Number.NEGATIVE_INFINITY;
    const restart = () => {
      const current = latest.current;
      clock.set(current.startMs);
      controller.setSpec({ ...spec, initialState: current.initialState });
      flushSync(() => controller.reset(current.initialState));
      ran = current;
      sent = 0;
    };
    const follow = (t: number) => {
      const current = latest.current;
      const sameStart = ran !== null && ran.startMs === current.startMs && ran.initialState === current.initialState;
      const sameSoFar = sameStart && ran!.events.slice(0, sent).every((event, i) => event.atMs === current.events[i]?.atMs && event.command === current.events[i]?.command);
      if (!sameSoFar || t < last) restart();
      ran = current;
      while (sent < current.events.length && current.events[sent]!.atMs <= t) {
        const event = current.events[sent]!;
        clock.advanceTo(event.atMs);
        flushSync(() => controller.send(event.command));
        sent += 1;
      }
      clock.advanceTo(t);
      last = t;
    };
    const stop = session.onFrame(follow);
    // Not from inside this commit: catching up may need a commit of its own.
    let live = true;
    queueMicrotask(() => {
      if (live) follow(session.time());
    });
    return () => {
      live = false;
      stop();
    };
  }, [spec, clock, controller, session]);

  return <>{showcase.registration.render({ frame, props, setProps: noop })}</>;
}
