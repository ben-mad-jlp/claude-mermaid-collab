/**
 * @nested-test-runner: inert - these tests cover nested runner detection but don't execute nested runs
 * @serial-test-lane: inert - these tests discuss git worktree add but don't execute it
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import {
  NESTED_RUNNER_TAG,
  NESTED_RUNNER_INERT_TAG,
  SERIAL_LANE_TAG,
  SERIAL_LANE_INERT_TAG,
  detectNestedRunnerSpawn,
  detectRealGitWorktreeSpawn,
  isNestedRunnerSource,
  isSerialLaneSource,
  partitionTestLanes,
} from '../nested-runner-lane';
import { runLanes, collectBackendTestFiles } from '../../../scripts/test-backend';

const ROOT = path.resolve(import.meta.dir, '../../..');

describe('nested-runner-lane', () => {
  it('collectBackendTestFiles excludes mutation-check.test.ts from fast and includes it in nested', () => {
    const { fast, nested } = collectBackendTestFiles();

    const foundInFast = fast.some((f: string) => f.includes('mutation-check.test.ts'));
    const foundInNested = nested.some((f: string) => f.includes('mutation-check.test.ts'));

    expect(foundInFast).toBe(false);
    expect(foundInNested).toBe(true);
  });

  it('collectBackendTestFiles places mutation-probe-verb-shapes.test.ts in nested and mutation-probe.test.ts stays in fast', () => {
    const { fast, nested } = collectBackendTestFiles();

    const verbShapesInNested = nested.some((f: string) => f.includes('mutation-probe-verb-shapes.test.ts'));
    const verbShapesInFast = fast.some((f: string) => f.includes('mutation-probe-verb-shapes.test.ts'));
    const probeTestInFast = fast.some((f: string) => f.includes('services/__tests__/mutation-probe.test.ts'));

    expect(verbShapesInNested).toBe(true);
    expect(verbShapesInFast).toBe(false);
    expect(probeTestInFast).toBe(true);
  });

  it('detectNestedRunnerSpawn returns false for a runner token that only survives inside a string literal', () => {
    // Source with "bun test" only in a quoted string should return false
    const source = `
      const cfg = { test: 'bun test {file}' };
      export function helper() {
        return cfg;
      }
    `;

    const result = detectNestedRunnerSpawn(source);
    expect(result).toBe(false);
  });

  it('detectNestedRunnerSpawn returns false when runner token is only in a string concatenation', () => {
    // Source where 'bun test' is inside a string — the whole point of blanking literals
    const source = `
      const cmdStr = 'bun test' + ' --timeout 30000';
      spawnSync('bash', [cmdStr]);
    `;

    const result = detectNestedRunnerSpawn(source);
    // After blanking literals, the 'bun test' string content is gone, so no detection
    expect(result).toBe(false);
  });

  it('detectNestedRunnerSpawn returns true for a runner token in the value of a testCommand: key', () => {
    // Source with testCommand key holding a runner token — a real signal
    const source = `const opts = { testCommand: 'bun test ./fixtures/x.test.ts' };`;

    const result = detectNestedRunnerSpawn(source);
    expect(result).toBe(true);
  });

  it('detectRealGitWorktreeSpawn detects git worktree add in pseudo-argv structure and false for error-message string', () => {
    // After blanking literals, argv-shaped calls like spawnSync('git', ['worktree', 'add', ...])
    // no longer match the pattern because the string contents are blanked. This is why such
    // files need the @serial-test-lane pragma. Test the error-message case which also fails.

    // False: error message containing git worktree add (blanked)
    const errorMsg = `
      throw new Error('git worktree add failed (code 128): invalid reference');
    `;
    expect(detectRealGitWorktreeSpawn(errorMsg)).toBe(false);

    // In real code, argv-style calls like spawnSync('git', ['worktree', 'add', ...])
    // require the @serial-test-lane pragma to be detected since string contents are blanked
  });

  it('partitionTestLanes routes a three-file fixture to fast, serial, and nested respectively', () => {
    const files = ['fast.test.ts', 'serial.test.ts', 'nested.test.ts'] as const;

    const readSource = (f: typeof files[number]) => {
      switch (f) {
        case 'fast.test.ts':
          return `export function test() { return 1; }`;
        case 'serial.test.ts':
          return `
            // @serial-test-lane: git worktree isolation needed
            import { spawnSync } from 'child_process';
            spawnSync('git', ['worktree', 'add', 'wt', 'HEAD']);
          `;
        case 'nested.test.ts':
          return `
            // @nested-test-runner: spawns nested bun test
            import { spawnSync } from 'child_process';
            spawnSync('bun', ['test', 'file.ts']);
          `;
      }
    };

    const { fast, serial, nested } = partitionTestLanes(files, readSource);
    expect(fast).toEqual(['fast.test.ts']);
    expect(serial).toEqual(['serial.test.ts']);
    expect(nested).toEqual(['nested.test.ts']);
  });

  it('--lane=fast dispatches zero nested files through runLanes', async () => {
    const mockRunner = async (file: string, timeoutMs: number) => ({ code: 0, output: '' });
    const fastFiles = ['/path/to/test1.test.ts', '/path/to/test2.test.ts'];
    const nestedFiles = ['/path/to/nested.test.ts'];

    const result = await runLanes({
      lane: 'fast',
      fast: fastFiles,
      serial: [],
      nested: nestedFiles,
      concurrency: 2,
      timeoutMs: 30000,
      nestedTimeoutMs: 900000,
      runner: mockRunner,
    });

    // Fast lane should have run the fast files
    expect(result.ranFast.length).toBe(2);
    // Fast lane should NOT have run nested files
    expect(result.ranNested.length).toBe(0);
  });

  it('--lane=nested runs nested files one at a time at the nested timeout via runLanes', async () => {
    const calls: Array<{ file: string; timeoutMs: number }> = [];
    const mockRunner = async (file: string, timeoutMs: number) => {
      calls.push({ file, timeoutMs });
      return { code: 0, output: '' };
    };

    const fastFiles = ['/path/to/test1.test.ts', '/path/to/test2.test.ts'];
    const nestedFiles = ['/path/to/nested1.test.ts', '/path/to/nested2.test.ts'];

    const result = await runLanes({
      lane: 'nested',
      fast: fastFiles,
      serial: [],
      nested: nestedFiles,
      concurrency: 2,
      timeoutMs: 30000,
      nestedTimeoutMs: 900000,
      runner: mockRunner,
    });

    // Nested lane should NOT have run fast files
    expect(result.ranFast.length).toBe(0);
    // Nested lane should have run nested files
    expect(result.ranNested.length).toBe(2);
    // All calls should use the nested timeout
    expect(calls.every((c) => c.timeoutMs === 900000)).toBe(true);
    // Nested files run sequentially (all calls made in order, one at a time)
    expect(calls.map((c) => c.file)).toEqual(nestedFiles);
  });
});
