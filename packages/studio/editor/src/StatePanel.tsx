import type { MotionSpec } from '../../runtime/spec';

export type Selection = { kind: 'state'; id: string } | { kind: 'transition'; id: string };

export function StatePanel({
  spec,
  selection,
  onSelect,
}: {
  spec: MotionSpec;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const is = (kind: Selection['kind'], id: string) => selection.kind === kind && selection.id === id;
  return (
    <div className="state-panel">
      <h2>States</h2>
      <ul className="list">
        {Object.entries(spec.states).map(([id, state]) => (
          <li key={id}>
            <button type="button" className="row" aria-pressed={is('state', id)} onClick={() => onSelect({ kind: 'state', id })}>
              <span>{state.label}</span>
              {id === spec.initialState ? <span className="tag">Start</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <h2>Transitions</h2>
      <ul className="list">
        {spec.transitions.map((t) => (
          <li key={t.id}>
            <button type="button" className="row" aria-pressed={is('transition', t.id)} onClick={() => onSelect({ kind: 'transition', id: t.id })}>
              <span>
                {spec.states[t.from]?.label} to {spec.states[t.to]?.label}
              </span>
              <span className="tag">{t.command}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
