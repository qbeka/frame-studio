import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative paths, so the built page works from any folder on any host.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: ['..'] } },
});
