import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // ui/ is the vitest root; the stage-B predicate module + shared fixture live above it.
      allow: [path.resolve(__dirname, '..')],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        // `src/` is TS source outside the ui/ root; it must be transformed, not externalized.
        inline: [/^@server\//, /\/src\/services\//],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      // Stage-B (`kind`) seam: let UI specs import the server-side predicate module and the
      // one shared kind fixture, so server and UI provably cannot disagree.
      '@server': path.resolve(__dirname, '../src'),
      '@shared-fixtures': path.resolve(__dirname, '../src/services/__fixtures__'),
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
});
