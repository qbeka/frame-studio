import type { MotionSpec } from '../../runtime/spec';
import { Graph } from './Graph';

export type Selection = { kind: 'state'; id: string } | { kind: 'transition'; id: string };

export function StatePanel({
  spec,
  current,
  selection,
  onSelect,
}: {
  spec: MotionSpec;
  current: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const is = (kind: Selection['kind'], id: string) => selection.kind === kind && selection.id === id;
  return (
    <div className="state-panel">
      <Graph spec={spec} current={current} selection={selection} onSelect={onSelect} />
      <h2>States</h2>
      <ul className="list">
        {Object.entries(spec.states).map(([id, state]) => (
          <li key={id}>
            <button type="button" className="row" aria-pressed={is('state', id)} onClick={() => onSelect({ kind: 'state', id })}>
              <span>{state.label}</span>
              <span className="tag">{id === current ? 'Now' : id === spec.initialState ? 'Start' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2>Transitions</h2>
      <ul className="list">
        {spec.transitions.map((t) => (
          <li key={t.id}>
            <button type="button" className="row" aria-pressed={is('transition', t.id)} onClick={() => onSelect({ kind: 'transition', id: t.id })}>
              <span className="row-move">
                <span>{spec.states[t.from]?.label}</span>
                <span className="tag"> to </span>
                <span>{spec.states[t.to]?.label}</span>
              </span>
              <span className="tag">{t.command}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
