import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Demo page: the real in-page UI on a sample site (`pnpm demo`), also built to demo-dist/. */
export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react()],
  build: { outDir: '../demo-dist', emptyOutDir: true, target: 'es2022' },
  server: { host: '127.0.0.1' },
});
