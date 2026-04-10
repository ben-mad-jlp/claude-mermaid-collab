import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const API_PORT = process.env.PORT || '3737';

export default defineConfig({
  plugins: [react()],
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
  css: {
    postcss: './postcss.config.js',
  },
});
