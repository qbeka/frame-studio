import { createRoot } from 'react-dom/client';
import 'frame-studio/runtime/frame.css';
import './foundation.css';
import './page.css';
import './essay.css';
import { Demo } from './Demo';

createRoot(document.getElementById('stage')!).render(<Demo />);

// Sections arrive as they come into view. With reduced motion they are simply there.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = [...document.querySelectorAll<HTMLElement>('.reveal')];
if (calm || typeof IntersectionObserver !== 'function') {
  for (const section of sections) section.dataset.seen = '';
} else {
  document.documentElement.classList.add('arriving');
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.seen = '';
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  for (const section of sections) seen.observe(section);
}

// The live figures are a chunk of their own, fetched when the first one is about to be seen.
const mounts = [...document.querySelectorAll<HTMLElement>('.mount[data-figure]')];
if (mounts.length > 0 && typeof IntersectionObserver === 'function') {
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      void import('./essay').then(({ mountFigure }) => mounts.forEach(mountFigure));
    },
    { rootMargin: '400px 0px' },
  );
  for (const mount of mounts) near.observe(mount);
}
