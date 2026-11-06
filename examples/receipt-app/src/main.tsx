import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame } from './motion/runtime';
import { motion } from './motion/motion.config';
import './motion/frame.css';
import { Receipt, initialReceiptProps, type ReceiptProps } from './Receipt';
import './receipt.css';
import { testOptions } from './testHarness';

const options = testOptions();

function App() {
  const frame = useFrame(motion, options);
  const [props, setProps] = useState<ReceiptProps>(initialReceiptProps);
  return <Receipt frame={frame} props={props} setProps={(patch) => setProps((p) => ({ ...p, ...patch }))} />;
}

createRoot(document.getElementById('root')!).render(<App />);
