'use client';

import { useState } from 'react';
import { useFrame } from './motion/runtime';
import { motion } from './motion/motion.config';
import { Inspector, initialInspectorProps, type InspectorProps } from './Inspector';

export function ExportedInspector() {
  const frame = useFrame(motion);
  const [props, setProps] = useState<InspectorProps>(initialInspectorProps);
  return <Inspector frame={frame} props={props} setProps={(patch) => setProps((p) => ({ ...p, ...patch }))} />;
}
