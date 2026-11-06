import { defineRegistration } from 'frame-studio/registration';
import type { FrameHandle } from 'frame-studio/runtime';
import './project-card.css';

/** The same markup as ProjectCard.tsx, with a handle passed in so the studio can drive it. */
function Card({ frame }: { frame: FrameHandle }) {
  const open = frame.state === 'open';
  return (
    <article {...frame.root()} className="pc">
      <div {...frame.target('surface')} className="pc-surface" aria-hidden="true" />
      <div {...frame.target('content')} className="pc-content">
        <button type="button" {...frame.target('head')} className="pc-head" aria-expanded={open} onClick={() => frame.send(open ? 'close' : 'open')}>
          <span className="pc-title">Project title</span>
          <span className="pc-summary">One line about the project.</span>
        </button>
        <div {...frame.target('more')} className="pc-more">
          <p>A short paragraph with the detail.</p>
          <a href="#read">Read the project</a>
        </div>
      </div>
    </article>
  );
}

export default [
  defineRegistration<Record<string, never>>({
    id: 'portfolio.project-card',
    version: '1.0.0',
    initialState: 'closed',
    states: {
      closed: { label: 'Closed', shows: ['surface', 'content', 'head'], focus: 'head' },
      open: { label: 'Open', shows: ['surface', 'content', 'head', 'more'], focus: 'head' },
    },
    targets: {
      surface: { label: 'Surface', bounds: 'surface', text: false },
      content: { label: 'Content clip', bounds: 'clip', text: true, clipRadiusPx: 18 },
      head: { label: 'Heading', bounds: 'translate', text: true },
      more: { label: 'Details', bounds: 'translate', text: true },
    },
    commands: { open: { label: 'Open' }, close: { label: 'Close' } },
    transitions: [
      { id: 'open', from: 'closed', to: 'open', command: 'open' },
      { id: 'close', from: 'open', to: 'closed', command: 'close' },
    ],
    props: {},
    reset() {},
    render: ({ frame }) => <Card frame={frame} />,
  }),
];
