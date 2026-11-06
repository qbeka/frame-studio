import { useEffect, useRef } from 'react';
import { useFrame } from './motion/runtime';
import { motion } from './motion/motion.config';
import './motion/frame.css';
import './project-card.css';

/**
 * A project card that opens in place and can be reversed at any moment. Escape closes it and
 * returns focus to the heading. It imports the exported motion folder and nothing from Frame.
 */
export function ProjectCard({ title, summary, details, href }: { title: string; summary: string; details: string; href: string }) {
  const frame = useFrame(motion);
  const open = frame.state === 'open';
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        frame.send('close');
        toggle.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <article {...frame.root()} className="pc">
      <div {...frame.target('surface')} className="pc-surface" aria-hidden="true" />
      <div {...frame.target('content')} className="pc-content">
        <button ref={toggle} type="button" {...frame.target('head')} className="pc-head" aria-expanded={open}
          onClick={() => frame.send(open ? 'close' : 'open')}>
          <span className="pc-title">{title}</span>
          <span className="pc-summary">{summary}</span>
        </button>
        <div {...frame.target('more')} className="pc-more">
          <p>{details}</p>
          <a href={href}>Read the project</a>
        </div>
      </div>
    </article>
  );
}
