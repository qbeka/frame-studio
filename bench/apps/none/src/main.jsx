import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './inspector.css';

// The same UI with no animation. Size baselines subtract this.
function App() {
  const [state, setState] = useState('compact');
  return (
    <section className="fx-inspector" style={{ background: '#fff', border: '1px solid #1115112e', borderRadius: 14 }}>
      <div className="fx-content">
        <header className="fx-summary"><span>Corner Bakery</span><span>$18.40</span></header>
        {state === 'compact' ? (
          <div className="fx-open"><button className="fx-button" onClick={() => setState('editing')}>Edit expense</button></div>
        ) : (
          <div className="fx-form"><p>Note</p><button className="fx-button" onClick={() => setState('compact')}>Cancel</button></div>
        )}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
