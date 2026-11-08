import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { pwaPlugin } from './tools/pwa/plugin';

export default defineConfig({
  base: './',
  plugins: [react(), pwaPlugin()],
  build: {
    rollupOptions: {
      input: 'index.html',
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
