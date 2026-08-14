import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { resolveVitestCacheDir } from '../src/services/vitest-cache-dir.ts';

const VITEST_CACHE_DIR = resolveVitestCacheDir(path.resolve(__dirname, '..'));

export default defineConfig({
  cacheDir: VITEST_CACHE_DIR,
  plugins: [react()],
  server: {
    fs: {
      // ui/ is the vitest root; the stage-B predicate module + shared fixture live above it.
      allow: [path.resolve(__dirname, '..')],
    },
  },
  test: {
    // QUARANTINE: red-by-design repros (../src/services/quarantine.ts). The `suites` gate lane
    // runs the WHOLE ui suite (`cd ui && bunx vitest --run`), so without this exclusion a
    // committed red UI repro reds the gate.
    exclude: ['**/node_modules/**', '**/dist/**', '**/__quarantine__/**'],
    // The gate lane runs this whole suite inside a multi-leaf pool, so wall-clock per test
    // is dominated by contention, not by the test's own work. vitest's 5s default turns
    // filesystem-walking source scans (which pass in ~1.4s alone) into rotating FALSE base
    // reds. Budget for the loaded case; a genuine hang still fails, just later.
    testTimeout: 30_000,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // vitest 0.34's VitestOptimizer overrides viteConfig.cacheDir with test.cache.dir.
    // Set it here to the per-worktree cache so concurrent vitest runs do not corrupt each other's deps.
    cache: { dir: VITEST_CACHE_DIR },
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
