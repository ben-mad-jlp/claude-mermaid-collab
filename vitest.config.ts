import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      // bun:test files — run via `bun test`, not vitest
      'src/routes/pseudo-api.test.ts',
      'src/types/update-log.test.ts',
      'src/services/__tests__/onboarding-db.test.ts',
      'src/services/__tests__/question-manager.test.ts',
      'src/services/__tests__/onboarding-manager.test.ts',
      'src/services/__tests__/pseudo-db.test.ts',
      'src/services/__tests__/source-scanner.test.ts',
      'src/mcp/tools/lessons.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
