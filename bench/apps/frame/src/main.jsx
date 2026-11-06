import { createRoot } from 'react-dom/client';
import { useFrame } from './motion/runtime';
import { motion } from './motion/motion.config';
import './motion/frame.css';
import './inspector.css';

// The same UI driven by an exported spec.
function App() {
  const frame = useFrame(motion);
  return (
    <section {...frame.root()} className="fx-inspector">
      <div {...frame.target('surface')} className="fx-surface" />
      <div {...frame.target('content')} className="fx-content">
        <header {...frame.target('summary')} className="fx-summary"><span>Corner Bakery</span><span>$18.40</span></header>
        <div {...frame.target('open')} className="fx-open"><button className="fx-button" onClick={() => frame.send('open')}>Edit expense</button></div>
        <div {...frame.target('form')} className="fx-form"><p>Note</p><button className="fx-button" onClick={() => frame.send('cancel')}>Cancel</button></div>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
