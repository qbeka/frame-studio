import { createRoot } from 'react-dom/client';
import { Replay } from './Replay';
import '@frame-studio/fixture-inspector/inspector.css';
import 'frame-studio/runtime/frame.css';

createRoot(document.getElementById('replay-root')!).render(<Replay />);

const ridge = document.getElementById('ridge')!;
addEventListener('scroll', () => {
  ridge.style.opacity = String(Math.max(0.25, 1 - scrollY / 800));
}, { passive: true });
