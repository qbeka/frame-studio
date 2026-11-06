import { createRoot } from 'react-dom/client';
import registrations from 'virtual:frame-registrations';
import '../../runtime/frame.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App registrations={registrations} />);
