import type { MotionSpec } from '../../runtime/spec';
import type { Selection } from './StatePanel';

const SIZE = { width: 212, height: 148 };
const NODE = { width: 82, height: 24 };

/** Places states evenly on an ellipse, starting at the top. */
function layout(ids: string[]) {
  const points: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    points[id] = { x: SIZE.width / 2 + Math.cos(angle) * 62, y: SIZE.height / 2 + Math.sin(angle) * 54 };
  });
  return points;
}

/** Where a line from a node's center leaves its box. */
function edgeOfNode(dx: number, dy: number) {
  const scale = Math.min(NODE.width / 2 / Math.max(Math.abs(dx), 1e-6), NODE.height / 2 / Math.max(Math.abs(dy), 1e-6));
  return { x: dx * scale, y: dy * scale };
}

/** A curved edge. Opposite edges bow to opposite sides, so both stay clickable. */
function edge(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const bow = 14;
  const mid = { x: (from.x + to.x) / 2 + nx * bow, y: (from.y + to.y) / 2 + ny * bow };
  const leave = edgeOfNode(mid.x - from.x, mid.y - from.y);
  const arrive = edgeOfNode(mid.x - to.x, mid.y - to.y);
  const gap = (v: { x: number; y: number }) => 1 + 4 / Math.hypot(v.x, v.y);
  const start = { x: from.x + leave.x * gap(leave), y: from.y + leave.y * gap(leave) };
  const end = { x: to.x + arrive.x * gap(arrive), y: to.y + arrive.y * gap(arrive) };
  return `M${start.x.toFixed(1)} ${start.y.toFixed(1)} Q${mid.x.toFixed(1)} ${mid.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/**
 * The compact state graph. Pointer only, on purpose: the state list below it has the same
 * selections and is the keyboard and screen reader path, so this is hidden from both.
 */
export function Graph({
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
  const points = layout(Object.keys(spec.states));
  return (
    <svg className="graph" viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} aria-hidden="true">
      <defs>
        <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="context-stroke" />
        </marker>
      </defs>
      {spec.transitions.map((t) => {
        const selected = selection.kind === 'transition' && selection.id === t.id;
        const d = edge(points[t.from]!, points[t.to]!);
        return (
          <g key={t.id} className="graph-edge" data-selected={selected || undefined} data-edge={t.id} onClick={() => onSelect({ kind: 'transition', id: t.id })}>
            <path d={d} className="graph-hit" />
            <path d={d} className="graph-line" markerEnd="url(#arrow)" />
          </g>
        );
      })}
      {Object.entries(spec.states).map(([id, state]) => {
        const p = points[id]!;
        const selected = selection.kind === 'state' && selection.id === id;
        return (
          <g key={id} className="graph-node" data-selected={selected || undefined} data-current={id === current || undefined} onClick={() => onSelect({ kind: 'state', id })}>
            <rect x={p.x - NODE.width / 2} y={p.y - NODE.height / 2} width={NODE.width} height={NODE.height} rx={NODE.height / 2} />
            <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle">
              {state.label.length > 13 ? `${state.label.slice(0, 12)}.` : state.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
