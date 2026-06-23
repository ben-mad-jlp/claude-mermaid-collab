import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import monacoEditorPluginModule from 'vite-plugin-monaco-editor';
const monacoEditorPlugin = (monacoEditorPluginModule as any).default ?? monacoEditorPluginModule;
import path from 'path';

const API_PORT = process.env.VITE_API_PORT || '9002';
console.log(`[vite] proxying /api, /ws, /terminal → http://localhost:${API_PORT}`);

export default defineConfig({
  plugins: [react(), tailwindcss(), monacoEditorPlugin({ languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'] })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    port: process.env.VITE_UI_PORT ? parseInt(process.env.VITE_UI_PORT, 10) : 5173,
    strictPort: true,
    open: false,
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) ?? 'all',
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
      },
      '/terminal': {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
      },
      // Per-server terminal bridge: the client namespaces the PTY WS URL as
      // /_per-server/<serverId>/terminal/<ptyId> (terminal-ws.ts). In the desktop
      // app a proxy strips /_per-server/<serverId> and forwards to the resolved
      // server (desktop/src/main/server-proxy.ts). In plain web dev there's only
      // one backend, so strip the prefix and forward the rest to the API.
      '/_per-server': {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
        rewrite: (p) => p.replace(/^\/_per-server\/[^/]*/, ''),
      },
      // Server-id-prefixed REST calls: apiFetch() routes writes through
      // /srv/<serverId>/api/... (api.ts). The desktop shell terminates this via
      // invokeOnServer; in plain web dev there's a single backend, so strip the
      // /srv/<serverId> segment (possibly empty/`local`) and forward to the API.
      '/srv': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/srv\/[^/]*/, ''),
      },
    },
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['canvaskit-wasm'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
  },
});
