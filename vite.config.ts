import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: 'dist/frontend',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
}));