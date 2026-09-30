import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // Electron loads dist/index.html over file://
  plugins: [react()],
  assetsInclude: ['**/*.frag', '**/*.vert'],
  build: {
    target: 'chrome120', // we ship a known Chromium; skip the polyfills
    rollupOptions: { input: { app: 'index.html', lab: 'lab.html' } },
  },
});
