import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Phase 0.1 — minimal electron-vite config: main / preload / renderer roots.
// Renderer is a placeholder for now; later phases load the collab UI from the
// supervised Bun sidecar instead.
export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
      rollupOptions: {
        output: {
          // `ws` is bundled into the main process. Vite replaces its optional
          // native deps (bufferutil / utf-8-validate) with frozen empty objects
          // instead of letting `require()` throw, so ws's pure-JS fallback never
          // engages and `bufferUtil.unmask` is undefined → crash on the first
          // masked WS frame. Forcing these env vars before any module init makes
          // ws use its pure-JS mask/unmask. A banner is the only placement the
          // bundler cannot reorder ahead of ws's module initializer.
          banner: "process.env.WS_NO_BUFFER_UTIL='1';process.env.WS_NO_UTF_8_VALIDATE='1';",
        },
      },
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
