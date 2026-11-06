import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame, type FrameOptions } from './motion/runtime';
import { motion } from './motion/motion.config';
import './motion/frame.css';
import { Inspector, initialInspectorProps, type InspectorProps } from './Inspector';
import './inspector.css';
import { testOptions } from './testHarness';

const options: FrameOptions = testOptions();

function App() {
  const frame = useFrame(motion, options);
  const [props, setProps] = useState<InspectorProps>(initialInspectorProps);
  return <Inspector frame={frame} props={props} setProps={(patch) => setProps((p) => ({ ...p, ...patch }))} />;
}

createRoot(document.getElementById('root')!).render(<App />);
