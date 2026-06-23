import { defineConfig } from 'vitest/config';
import * as path from 'path';
import { readFileSync, readdirSync } from 'fs';

const ROOT = __dirname;
const TEST_ROOTS = ['src', 'extensions/vscode/src', 'desktop/src'];

/**
 * Dynamically exclude every test file that runs under `bun test` (imports
 * 'bun:test') — they use bun-only APIs and would fail to load under vitest with
 * "Cannot find package 'bun:test'". Detecting them by content (instead of a
 * hand-maintained list) keeps `npm run test:backend` clean as new bun tests are
 * added. The bun tests are run separately via `bun test`.
 */
function bunTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(rel);
      } else if (/\.test\.tsx?$/.test(e.name)) {
        try {
          if (/from ['"]bun:test['"]/.test(readFileSync(path.join(ROOT, rel), 'utf8'))) {
            out.push(rel);
          }
        } catch { /* unreadable — skip */ }
      }
    }
  };
  for (const r of TEST_ROOTS) walk(r);
  return out;
}

/**
 * Integration tests that spin up real servers / sockets / tmux panes or rely on
 * the better-sqlite3 native addon. They leak ports/handles across files (which
 * deadlocks the serialized run) or fail to load under Node's ABI, so they're
 * excluded from the default `test:backend` and run deliberately via
 * `test:backend:integration` (RUN_INTEGRATION=1). See docs / step-3 quarantine.
 */
const INTEGRATION_EXCLUDES = [
  'src/**/*.integration.test.ts',
  'src/services/__tests__/terminal-manager.test.ts',
  'src/agent/__tests__/projector.eventlog.test.ts',
  'src/services/__tests__/status-integration.test.ts',
];
const runIntegration = process.env.RUN_INTEGRATION === '1';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'extensions/vscode/src/**/*.test.ts', 'desktop/src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      ...bunTestFiles(),
      ...(runIntegration ? [] : INTEGRATION_EXCLUDES),
    ],
    setupFiles: ['./vitest.setup.ts'],
    // Backend tests share on-disk state (SQLite DBs / temp dirs at fixed paths),
    // so running test FILES in parallel causes cross-file contention → a shifting
    // set of flaky failures (each test passes in isolation). Serialize files for
    // determinism; within-file tests still run normally. Correctness over speed.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
    },
  },
  // The VS Code extension imports the ambient `vscode` module, which only
  // exists inside the VS Code host. Alias it to a manual mock so the
  // extension's pure logic can be unit-tested under vitest.
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'extensions/vscode/src/__tests__/vscode-mock.ts'),
    },
  },
});
