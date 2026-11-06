import type { FrameHandle } from 'frame-studio/runtime';
import { defineRegistration, type TargetDefinition } from 'frame-studio/registration';

/** The same component with a chosen number of declared targets, for the authoring benchmark. */
function Rows({ frame, count }: { frame: FrameHandle; count: number }) {
  return (
    <section {...frame.root()} style={{ width: 360, font: '14px system-ui' }}>
      <div {...frame.target('surface')} style={{ background: '#fff', border: '1px solid #1115112e', borderRadius: 12 }} />
      <button type="button" onClick={() => frame.send('toggle')} style={{ margin: 8 }}>Toggle</button>
      {Array.from({ length: count - 1 }, (_, i) => (
        <div key={i} {...frame.target(`row${i}`)} style={{ padding: '2px 12px' }}>Row {i + 1} of declared content</div>
      ))}
    </section>
  );
}

function registration(count: number) {
  const rows = Array.from({ length: count - 1 }, (_, i) => `row${i}`);
  const targets: Record<string, TargetDefinition> = { surface: { label: 'Surface', bounds: 'surface', text: false } };
  for (const id of rows) targets[id] = { label: id, bounds: 'translate', text: true };
  return defineRegistration<Record<string, never>>({
    id: `bench.rows.${count}`,
    version: '1.0.0',
    initialState: 'closed',
    states: {
      closed: { label: 'Closed', shows: ['surface'] },
      open: { label: 'Open', shows: ['surface', ...rows] },
    },
    targets,
    commands: { toggle: { label: 'Toggle' } },
    transitions: [
      { id: 'open', from: 'closed', to: 'open', command: 'toggle' },
      { id: 'close', from: 'open', to: 'closed', command: 'toggle' },
    ],
    props: {},
    reset() {},
    render: ({ frame }) => <Rows frame={frame} count={count} />,
  });
}

export default [registration(1), registration(10), registration(30), registration(200)];
