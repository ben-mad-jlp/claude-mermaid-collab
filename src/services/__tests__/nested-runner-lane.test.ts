/**
 * @nested-test-runner: inert - these tests cover nested runner detection but don't execute nested runs
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import {
  NESTED_RUNNER_TAG,
  NESTED_RUNNER_INERT_TAG,
  detectNestedRunnerSpawn,
  isNestedRunnerSource,
  partitionNestedRunners,
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

  it('detectNestedRunnerSpawn does not flag a bun test mention that only survives in a comment', () => {
    // Source with bun test only in a comment should return false
    const source = `
      // This test file runs bun test in a subprocess
      export function helper() {
        return 42;
      }
    `;

    const result = detectNestedRunnerSpawn(source);
    expect(result).toBe(false);
  });

  it('detectNestedRunnerSpawn flags a spawnSync bash argv shaped bun test invocation', () => {
    // Source with spawnSync carrying 'bun','test' as adjacent argv elements
    const source = `
      const r = spawnSync('bash', ['script.sh', 'mutation', ...cmd], { cwd: dir, encoding: 'utf8' });
      // But the shell script itself contains argv-style bun/test
      const args = ['bun', 'test', '--timeout', '30000'];
    `;

    const result = detectNestedRunnerSpawn(source);
    expect(result).toBe(true);
  });

  it('--lane=fast dispatches zero nested files through runLanes', async () => {
    const mockRunner = async (file: string, timeoutMs: number) => ({ code: 0, output: '' });
    const fastFiles = ['/path/to/test1.test.ts', '/path/to/test2.test.ts'];
    const nestedFiles = ['/path/to/nested.test.ts'];

    const result = await runLanes({
      lane: 'fast',
      fast: fastFiles,
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
