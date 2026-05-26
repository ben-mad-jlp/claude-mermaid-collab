import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Phase 0.1 — minimal electron-vite config: main / preload / renderer roots.
// Renderer is a placeholder for now; later phases load the collab UI from the
// supervised Bun sidecar instead.
export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    build: {
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
