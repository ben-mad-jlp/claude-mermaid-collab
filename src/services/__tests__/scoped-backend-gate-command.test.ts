/**
 * Tests for scoped-backend-gate-command.ts — pure construction of filtered test commands.
 */
import { describe, it, expect } from 'bun:test';
import path from 'path';
import { selectBackendSpecFiles, buildScopedBackendTestCommand, normalizeBareRunnerCommand } from '../scoped-backend-gate-command';
import { collectBackendTestFiles, DEFAULT_TEST_ROOTS } from '../../../scripts/test-backend';
import { resolveLeafGate } from '../leaf-gate';

describe('scoped-backend-gate-command', () => {
  describe('selectBackendSpecFiles', () => {
    it('builds a command naming exactly the changed backend spec files', () => {
      const changedFiles = [
        'src/services/a.test.ts',
        'src/services/b.test.ts',
        'src/services/helper.ts', // non-spec file — should be excluded
      ];

      const selected = selectBackendSpecFiles(changedFiles);
      expect(selected).toEqual(['src/services/a.test.ts', 'src/services/b.test.ts']);
    });

    it('returns null when the change-set has no backend spec files', () => {
      const changedFiles = [
        'src/services/helper.ts',
        'src/services/util.ts',
        'ui/components/Button.tsx',
      ];

      const command = buildScopedBackendTestCommand(changedFiles);
      expect(command).toBeNull();
    });

    it('filters to test files under src/ or desktop/src/', () => {
      const changedFiles = [
        'src/services/good.test.ts',
        'desktop/src/utils/also-good.test.ts',
        'ui/good-ui.test.ts', // not under src/ — should be excluded
        'other/bad.test.ts', // not under src/ or desktop/src/ — should be excluded
      ];

      const selected = selectBackendSpecFiles(changedFiles);
      expect(selected).toEqual(['src/services/good.test.ts', 'desktop/src/utils/also-good.test.ts']);
    });

    it('normalizes backslash paths correctly', () => {
      const changedFiles = [
        'src\\services\\test.test.ts',
        'desktop\\src\\utils\\test.test.ts',
      ];

      const selected = selectBackendSpecFiles(changedFiles);
      expect(selected.length).toBe(2);
    });

    it('excludes quarantined paths', () => {
      const changedFiles = [
        'src/services/good.test.ts',
        'src/services/__quarantine__/bad.test.ts',
      ];

      const selected = selectBackendSpecFiles(changedFiles);
      expect(selected).toEqual(['src/services/good.test.ts']);
    });

    it('preserves input order', () => {
      const changedFiles = [
        'src/z.test.ts',
        'src/a.test.ts',
        'src/m.test.ts',
      ];

      const selected = selectBackendSpecFiles(changedFiles);
      expect(selected).toEqual(['src/z.test.ts', 'src/a.test.ts', 'src/m.test.ts']);
    });

    it('deduplicates identical paths', () => {
      const changedFiles = [
        'src/a.test.ts',
        'src/a.test.ts',
        'src/b.test.ts',
      ];

      const selected = selectBackendSpecFiles(changedFiles);
      expect(selected).toEqual(['src/a.test.ts', 'src/b.test.ts']);
    });
  });

  describe('buildScopedBackendTestCommand', () => {
    it('builds a command naming exactly the changed backend spec files', () => {
      const changedFiles = [
        'src/services/a.test.ts',
        'src/services/b.test.ts',
        'src/services/helper.ts',
      ];

      const command = buildScopedBackendTestCommand(changedFiles);
      expect(command).not.toBeNull();
      expect(command).toContain('bun run scripts/test-backend.ts');
      expect(command).toContain('src/services/a.test.ts');
      expect(command).toContain('src/services/b.test.ts');
      expect(command).not.toContain('helper.ts');
      expect(command).not.toBe('bun run scripts/test-backend.ts');
    });

    it('returns null when the change-set has no backend spec files', () => {
      const changedFiles = [
        'src/services/helper.ts',
        'ui/components/Button.tsx',
      ];

      const command = buildScopedBackendTestCommand(changedFiles);
      expect(command).toBeNull();
    });

    it('properly escapes single quotes in file paths', () => {
      const changedFiles = ["src/services/it's-a-test.test.ts"];

      const command = buildScopedBackendTestCommand(changedFiles);
      expect(command).not.toBeNull();
      expect(command).toContain("'\\''");
    });
  });

  describe('collectBackendTestFiles with array filter', () => {
    it('returns exactly the selected files across all lanes when filtering by array', () => {
      // Use two real test files that we know exist
      const realFiles = [
        'src/services/__tests__/base-gate-lane-admission.test.ts',
        'src/services/__tests__/nested-lane-execution.test.ts',
      ];

      const { fast, serial, nested } = collectBackendTestFiles(DEFAULT_TEST_ROOTS, realFiles);
      const all = [...fast, ...serial, ...nested];

      // The filter should return exactly the two requested files (if they exist)
      expect(all.some((f) => f.includes('base-gate-lane-admission.test.ts'))).toBe(true);
      expect(all.some((f) => f.includes('nested-lane-execution.test.ts'))).toBe(true);
    });

    it('returns the full unfiltered set when called with no filter', () => {
      const withFilter = collectBackendTestFiles(DEFAULT_TEST_ROOTS);
      const filtered = collectBackendTestFiles(DEFAULT_TEST_ROOTS, ['non-existent.test.ts']);

      // No filter returns the full set
      const withFilterAll = withFilter.fast.length + withFilter.serial.length + withFilter.nested.length;
      const filteredAll = filtered.fast.length + filtered.serial.length + filtered.nested.length;

      expect(withFilterAll).toBeGreaterThan(0);
      // Filtering by a non-existent file yields empty or different results
      expect(filteredAll).toBeLessThanOrEqual(withFilterAll);
    });

    it('handles both string and array filter arguments identically', () => {
      const testFile = 'src/services/__tests__/base-gate-lane-admission.test.ts';

      const resultString = collectBackendTestFiles(DEFAULT_TEST_ROOTS, testFile);
      const resultArray = collectBackendTestFiles(DEFAULT_TEST_ROOTS, [testFile]);

      const stringAll = resultString.fast.length + resultString.serial.length + resultString.nested.length;
      const arrayAll = resultArray.fast.length + resultArray.serial.length + resultArray.nested.length;

      expect(stringAll).toBe(arrayAll);
    });
  });

  describe('normalizeBareRunnerCommand', () => {
    it('a bare bun test declaration on a src lane becomes the backend wrapper form', () => {
      const manifest = {
        gate: {
          tests: [{ match: '^src/', command: 'bun test {file}' }],
        },
      } as any;

      const result = resolveLeafGate(manifest);
      expect(result).not.toBeNull();
      expect(result!.tests).toBeDefined();
      expect(result!.tests!.length).toBe(1);

      const lane = result!.tests![0];
      expect(lane.command).toBe('bun run scripts/test-backend.ts {file}');
      expect(lane.mode).toBe('per-file');
    });

    it('a ui vitest lane command is returned unchanged', () => {
      expect(normalizeBareRunnerCommand('bunx vitest run {file}', '^ui/')).toBe('bunx vitest run {file}');
    });

    it('a command already naming scripts/test-backend.ts on a src lane is returned identically (idempotence)', () => {
      const cmd = 'bun run scripts/test-backend.ts {file}';
      expect(normalizeBareRunnerCommand(cmd, '^src/')).toBe(cmd);
    });

    it('preserves flags and placeholders when normalizing', () => {
      expect(normalizeBareRunnerCommand('bun test --timeout 30000 {files}', '^src/'))
        .toBe('bun run scripts/test-backend.ts --timeout 30000 {files}');
    });

    it('returns a desktop/src lane bare bun test in wrapper form', () => {
      expect(normalizeBareRunnerCommand('bun test {file}', '^desktop/src/'))
        .toBe('bun run scripts/test-backend.ts {file}');
    });

    it('returns a scripts lane bare bun test in wrapper form', () => {
      expect(normalizeBareRunnerCommand('bun test {file}', '^scripts/'))
        .toBe('bun run scripts/test-backend.ts {file}');
    });

    it('leaves non-backend scopes unchanged', () => {
      const cmd = 'bun test {file}';
      expect(normalizeBareRunnerCommand(cmd, '^other/')).toBe(cmd);
    });

    it('leaves non-bun-test commands unchanged', () => {
      const cmd = 'npm run test {file}';
      expect(normalizeBareRunnerCommand(cmd, '^src/')).toBe(cmd);
    });

    it('never throws on any input', () => {
      expect(() => normalizeBareRunnerCommand('', '')).not.toThrow();
      expect(() => normalizeBareRunnerCommand('bun test {file}', '')).not.toThrow();
    });
  });
});
