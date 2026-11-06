import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, LazyMotion, domMax, m as motion } from 'motion/react';
import './inspector.css';

// The Motion baseline again, using LazyMotion, its documented way to reduce bundle size.
const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 1 };
const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 }, transition: spring };

function App() {
  const [state, setState] = useState('compact');
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

createRoot(document.getElementById('root')).render(<LazyMotion features={domMax}><App /></LazyMotion>);
