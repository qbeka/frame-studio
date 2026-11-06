import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'motion/react';
import './inspector.css';

// Hand-written with Motion, with the timing of the authored spec: a soft spring to open, a firmer
// one to close or reverse, a quick fade out for what leaves, and a delayed fade in for what enters.
const quiet = { type: 'spring', stiffness: 420, damping: 34, mass: 1 };
const firm = { type: 'spring', stiffness: 700, damping: 48, mass: 1 };
const ease = [0.2, 0, 0, 1];

function App() {
  const [state, setState] = useState('compact');
  const spring = state === 'compact' ? firm : quiet;
  const enter = { y: spring, opacity: { duration: 0.18, delay: 0.04, ease } };
  const leave = { opacity: 0, y: 6, transition: { y: spring, opacity: { duration: 0.09, ease } } };
  const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0, transition: enter }, exit: leave };
  return (
    <motion.section layout transition={spring} className="fx-inspector" style={{ background: '#fff', border: '1px solid #1115112e', borderRadius: 14, overflow: 'hidden' }}>
      <div className="fx-content">
        <motion.header layout="position" transition={spring} className="fx-summary"><span>Corner Bakery</span><span>$18.40</span></motion.header>
        <AnimatePresence initial={false} mode="popLayout">
          {state === 'compact' ? (
            <motion.div key="open" className="fx-open" {...fade}><button className="fx-button" onClick={() => setState('editing')}>Edit expense</button></motion.div>
          ) : (
            <motion.div key="form" className="fx-form" {...fade}><p>Note</p><button className="fx-button" onClick={() => setState('compact')}>Cancel</button></motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
