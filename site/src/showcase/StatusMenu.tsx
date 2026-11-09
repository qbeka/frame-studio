import type { KeyboardEvent } from 'react';
import type { FrameHandle } from 'frame-studio/runtime';

/**
 * A status picker that grows out of its own button. Synthetic content, like the expense card.
 * The list is always mounted and only hidden, so focus and the checked item survive a reversal.
 */
export const STATUSES = ['Backlog', 'In progress', 'In review', 'Done', 'Paused'];

export type StatusMenuProps = { status: string };
export const initialStatusMenuProps: StatusMenuProps = { status: 'In review' };

const slug = (status: string) => status.toLowerCase().replace(/\s+/g, '-');

export function StatusMenu({
  frame,
  props,
  setProps,
}: {
  frame: FrameHandle;
  props: StatusMenuProps;
  setProps: (patch: Partial<StatusMenuProps>) => void;
}) {
  const open = frame.state === 'open';

  function items(root: Element) {
    return [...root.querySelectorAll<HTMLElement>('[role=menuitemradio]')];
  }

  function pick(status: string, root: Element) {
    setProps({ status });
    frame.send('close');
    root.querySelector<HTMLElement>('.sc-menu-trigger')?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const root = event.currentTarget;
    const list = items(root);
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      frame.send('close');
      root.querySelector<HTMLElement>('.sc-menu-trigger')?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        frame.send('open');
        return;
      }
      const checked = list.findIndex((item) => item.getAttribute('aria-checked') === 'true');
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = at === -1 ? Math.max(0, checked) : (at + step + list.length) % list.length;
      list[next]?.focus({ preventScroll: true });
      return;
    }
    if (!open) return;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      list[event.key === 'Home' ? 0 : list.length - 1]?.focus({ preventScroll: true });
      return;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= STATUSES.length) pick(STATUSES[digit - 1]!, root);
  }

  return (
    <div {...frame.root()} className="sc-menu" data-state={frame.state} onKeyDown={onKeyDown}>
      <div {...frame.target('surface')} className="sc-menu-surface" aria-hidden="true" />
      <div {...frame.target('content')} className="sc-menu-content">
        <button
          {...frame.target('trigger')}
          type="button"
          className="sc-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => frame.send(open ? 'close' : 'open')}
        >
          <i className="sc-status" data-status={slug(props.status)} aria-hidden="true" />
          <span className="sc-menu-kind">Status</span>
          <span className="sc-menu-value">{props.status}</span>
          <svg className="sc-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div {...frame.target('list')} className="sc-menu-list" role="menu" aria-label="Status">
          {STATUSES.map((status, i) => (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={status === props.status}
              className="sc-menu-item"
              onClick={(event) => pick(status, event.currentTarget.closest('.sc-menu')!)}
            >
              <i className="sc-status" data-status={slug(status)} aria-hidden="true" />
              <span>{status}</span>
              <svg className="sc-check" width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden="true">
                <path d="M1 5.2l3.4 3.3L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <kbd aria-hidden="true">{i + 1}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
