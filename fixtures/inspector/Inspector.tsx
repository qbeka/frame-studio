import { useId, type FormEvent, type KeyboardEvent } from 'react';
import type { FrameHandle } from 'frame-studio/runtime';

/**
 * A synthetic expense inspector. It knows nothing about the studio. It takes a frame handle, and
 * production passes the same handle from `useFrame`.
 *
 * All content is props, so a take can capture a content edit as well as a command. Fields are
 * always mounted and only hidden, which is what keeps typed text and focus through a transition.
 */
export const CATEGORIES = ['Food', 'Travel', 'Software', 'Rent'];

export interface InspectorProps extends Record<string, string | number | boolean> {
  merchant: string;
  amount: string;
  category: string;
  note: string;
  error: string;
  saving: boolean;
}

export const initialInspectorProps: InspectorProps = {
  merchant: 'Corner Bakery',
  amount: '18.40',
  category: 'Food',
  note: 'Team breakfast',
  error: '',
  saving: false,
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Stands in for a network save. Long enough to reverse by hand. */
export const SAVE_MS = 1600;

export function cancelSave() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
}

function validate(props: InspectorProps) {
  if (props.merchant.trim() === '') return 'Add a merchant name.';
  const amount = Number(props.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount above zero, such as 18.40.';
  return '';
}

export function Inspector({
  frame,
  props,
  setProps,
}: {
  frame: FrameHandle;
  props: InspectorProps;
  setProps: (patch: Partial<InspectorProps>) => void;
}) {
  const id = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validate(props);
    if (error) {
      setProps({ error });
      return;
    }
    setProps({ error: '', saving: true });
    frame.send('submit');
    cancelSave();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      setProps({ saving: false });
    }, SAVE_MS);
  }

  function keepEditing() {
    cancelSave();
    setProps({ saving: false });
    frame.send('back');
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (frame.state === 'editing') frame.send('cancel');
    if (frame.state === 'confirmation' && props.saving) keepEditing();
  }

  return (
    <section {...frame.root()} className="fx-inspector" aria-label="Expense" onKeyDown={onKeyDown}>
      <div {...frame.target('surface')} className="fx-surface" aria-hidden="true" />
      <div {...frame.target('content')} className="fx-content">
        <header {...frame.target('summary')} className="fx-summary">
          <div className="fx-title">
            <span className="fx-merchant">{props.merchant || 'Untitled expense'}</span>
            <span className="fx-meta">{props.category}</span>
          </div>
          <span className="fx-amount">${props.amount || '0.00'}</span>
        </header>

        <div {...frame.target('open')} className="fx-open">
          <button type="button" className="fx-button" onClick={() => frame.send('open')}>
            Edit expense
          </button>
        </div>

        <form {...frame.target('form')} className="fx-form" onSubmit={submit} noValidate>
          <label className="fx-field" htmlFor={`${id}-merchant`}>
            Merchant
            <input
              id={`${id}-merchant`}
              value={props.merchant}
              onChange={(e) => setProps({ merchant: e.target.value })}
              aria-invalid={props.error.includes('merchant')}
            />
          </label>
          <div className="fx-row">
            <label className="fx-field" htmlFor={`${id}-amount`}>
              Amount
              <input
                id={`${id}-amount`}
                inputMode="decimal"
                value={props.amount}
                onChange={(e) => setProps({ amount: e.target.value })}
                aria-invalid={props.error.includes('amount')}
              />
            </label>
            <label className="fx-field" htmlFor={`${id}-category`}>
              Category
              <select
                id={`${id}-category`}
                value={props.category}
                onChange={(e) => setProps({ category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="fx-field" htmlFor={`${id}-note`}>
            Note
            <textarea
              id={`${id}-note`}
              rows={2}
              value={props.note}
              onChange={(e) => setProps({ note: e.target.value })}
            />
          </label>
          {props.error ? (
            <p className="fx-error" role="alert">
              {props.error}
            </p>
          ) : null}
          <div className="fx-actions">
            <button type="button" className="fx-button fx-quiet" onClick={() => frame.send('cancel')}>
              Cancel
            </button>
            <button type="submit" className="fx-button fx-primary">
              Save
            </button>
          </div>
        </form>

        <div {...frame.target('receipt')} className="fx-receipt" tabIndex={-1}>
          <p className="fx-status" role="status">
            {props.saving ? 'Saving this expense' : 'Saved to your ledger'}
          </p>
          <dl className="fx-lines">
            <div>
              <dt>Category</dt>
              <dd>{props.category}</dd>
            </div>
            <div>
              <dt>Note</dt>
              <dd>{props.note || 'None'}</dd>
            </div>
          </dl>
          <div className="fx-actions">
            {props.saving ? (
              <button type="button" className="fx-button fx-quiet" onClick={keepEditing}>
                Keep editing
              </button>
            ) : (
              <button type="button" className="fx-button fx-primary" onClick={() => frame.send('done')}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
