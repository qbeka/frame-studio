import { useId, type FormEvent, type KeyboardEvent } from 'react';
import type { FrameHandle } from 'frame-studio/runtime';

/**
 * A day plan with a bottom sheet for adding a stop. Synthetic content. The sheet is one target
 * that waits below the screen, so opening and closing it is a pure vertical move.
 */
export const SLOTS = ['Morning', 'Afternoon', 'Evening'];
const TIMES: Record<string, string> = { Morning: '10:30', Afternoon: '14:00', Evening: '19:15' };

export type StopSheetProps = { name: string; slot: string; added: string; addedSlot: string };
export const initialStopSheetProps: StopSheetProps = { name: 'Lighthouse', slot: 'Afternoon', added: '', addedSlot: '' };

const PLAN = [
  { time: '09:40', name: 'Ferry to the island' },
  { time: '12:30', name: 'Lunch at the harbour' },
];

export function StopSheet({
  frame,
  props,
  setProps,
}: {
  frame: FrameHandle;
  props: StopSheetProps;
  setProps: (patch: Partial<StopSheetProps>) => void;
}) {
  const id = useId();
  const open = frame.state === 'open';

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = props.name.trim();
    if (name === '') return;
    setProps({ added: name, addedSlot: props.slot });
    frame.send('close');
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) frame.send('close');
  }

  return (
    <div {...frame.root()} className="sc-phone" data-state={frame.state} onKeyDown={onKeyDown}>
      <div className="sc-screen" {...(open ? { inert: true } : {})}>
        <header className="sc-screen-head">
          <span className="sc-screen-title">Saturday</span>
          <span className="sc-screen-meta">{props.added ? '3 stops' : '2 stops'}</span>
        </header>
        <ol className="sc-plan">
          {PLAN.map((stop) => (
            <li key={stop.name}>
              <time>{stop.time}</time>
              <span>{stop.name}</span>
            </li>
          ))}
          {props.added ? (
            <li data-new="">
              <time>{TIMES[props.addedSlot] ?? TIMES.Afternoon}</time>
              <span>{props.added}</span>
            </li>
          ) : null}
        </ol>
        <div {...frame.target('add')} className="sc-add">
          <button type="button" className="sc-button sc-primary" onClick={() => frame.send('open')}>
            Add a stop
          </button>
        </div>
      </div>

      <div {...frame.target('scrim')} className="sc-scrim" onClick={() => frame.send('close')} />

      <form {...frame.target('sheet')} className="sc-sheet" aria-label="New stop" onSubmit={submit} noValidate>
        <i className="sc-grabber" aria-hidden="true" />
        <label className="sc-field" htmlFor={`${id}-name`}>
          Stop
          <input id={`${id}-name`} value={props.name} onChange={(event) => setProps({ name: event.target.value })} autoComplete="off" />
        </label>
        <div className="sc-slots" role="group" aria-label="Time of day">
          {SLOTS.map((slot) => (
            <button key={slot} type="button" className="sc-slot" aria-pressed={slot === props.slot} onClick={() => setProps({ slot })}>
              {slot}
            </button>
          ))}
        </div>
        <div className="sc-sheet-actions">
          <button type="button" className="sc-button" onClick={() => frame.send('close')}>
            Cancel
          </button>
          <button type="submit" className="sc-button sc-primary" aria-disabled={props.name.trim() === '' || undefined}>
            Add to plan
          </button>
        </div>
      </form>
    </div>
  );
}
