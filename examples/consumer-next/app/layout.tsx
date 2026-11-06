import type { ReactNode } from 'react';
import './motion/frame.css';
import './inspector.css';

export const metadata = { title: 'Exported interaction in Next.js' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 24, background: '#fbf8f4', display: 'flex', justifyContent: 'center' }}>{children}</body>
    </html>
  );
}
