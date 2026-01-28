import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
      // Use browser build of mermaid-wireframe (avoids Node.js fs/path requires)
      'mermaid-wireframe': path.resolve(__dirname, '../plugins/wireframe/dist/mermaid-wireframe.browser.js'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3737',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3737',
        ws: true,
      },
      '/terminal': {
        target: 'ws://localhost:3737',
        ws: true,
      },
    },
  },
  build: {
    target: 'ES2020',
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
  },
  css: {
    postcss: './postcss.config.js',
  },
});
