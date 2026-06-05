import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'extensions/vscode/src/**/*.test.ts', 'desktop/src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      // bun:test files — run via `bun test`, not vitest
      'src/types/update-log.test.ts',
      'src/services/__tests__/question-manager.test.ts',
      'src/services/__tests__/todo-store.test.ts',
      'src/services/__tests__/todo-migration.test.ts',
      'src/mcp/tools/lessons.test.ts',
      'src/config/__tests__/project-manifest.test.ts',
      'src/config/__tests__/agent-profiles.test.ts',
      'src/services/__tests__/friction-store.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
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
