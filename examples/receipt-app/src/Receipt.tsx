import type { FrameHandle } from 'frame-studio/runtime';

// Synthetic content. The only Frame import is a type, which is erased at build time.
export type ReceiptProps = { vendor: string; total: string; reason: string };

export const initialReceiptProps: ReceiptProps = { vendor: 'Harbour Fuel', total: '62.15', reason: '' };

const ITEMS = [
  ['Fuel, 40.2 L', '58.90'],
  ['Car wash', '3.25'],
];

export function Receipt({
  frame,
  props,
  setProps,
}: {
  frame: FrameHandle;
  props: ReceiptProps;
  setProps: (patch: Partial<ReceiptProps>) => void;
}) {
  return (
    <article {...frame.root()} className="receipt" aria-label="Receipt">
      <div {...frame.target('paper')} className="paper" aria-hidden="true" />
      <div {...frame.target('sheet')} className="sheet">
        <button type="button" {...frame.target('head')} className="head" aria-expanded={frame.state !== 'folded'}
          onClick={() => frame.send(frame.state === 'folded' ? 'unfold' : 'fold')}>
          <span>{props.vendor}</span>
          <span>${props.total}</span>
        </button>
        <ul {...frame.target('lines')} className="lines">
          {ITEMS.map(([label, amount]) => (
            <li key={label}>
              <span>{label}</span>
              <span>${amount}</span>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => frame.send('dispute')}>Dispute this charge</button>
          </li>
        </ul>
        <div {...frame.target('dispute')} className="dispute">
          <label>
            What went wrong?
            <input value={props.reason} onChange={(e) => setProps({ reason: e.target.value })} />
          </label>
          <button type="button" onClick={() => frame.send('withdraw')}>Withdraw</button>
        </div>
      </div>
      <div {...frame.target('stamp')} className="stamp" aria-hidden="true" />
    </article>
  );
}
