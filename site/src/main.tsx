import { createRoot } from 'react-dom/client';
import '@frame-studio/fixture-inspector/inspector.css';
import 'frame-studio/runtime/frame.css';
import './foundation.css';
import './page.css';
import { Demo } from './Demo';

createRoot(document.getElementById('stage')!).render(<Demo />);
