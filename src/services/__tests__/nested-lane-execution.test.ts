/**
 * @nested-test-runner: inert - these tests cover nested lane dispatch but don't execute real nested runs
 * @serial-test-lane: inert - these tests don't spawn git worktree operations
 */
import { describe, it, expect } from 'bun:test';
import path from 'path';
import { runLanes, collectBackendTestFiles } from '../../../scripts/test-backend';

const ROOT = path.resolve(import.meta.dir, '../../..');

describe('nested lane execution', () => {
  it('reports the failing fixture with its file and output', async () => {
    const mockRunner = async (file: string, timeoutMs: number) => {
      if (file === '/fixture/a.test.ts') {
        return { code: 1, output: 'FAIL a.test.ts: assertion mismatch' };
      }
      if (file === '/fixture/b.test.ts') {
        return { code: 0, output: '' };
      }
      return { code: 0, output: '' };
    };

    const result = await runLanes({
      lane: 'nested',
      fast: [],
      serial: [],
      nested: ['/fixture/a.test.ts', '/fixture/b.test.ts'],
      concurrency: 2,
      timeoutMs: 30000,
      nestedTimeoutMs: 900000,
      runner: mockRunner,
    });

    expect(result.failed.length).toBe(1);
    expect(result.failed[0].file.endsWith('a.test.ts')).toBe(true);
    expect(result.failed[0].output).toBe('FAIL a.test.ts: assertion mismatch');
    expect(result.ranNested).toEqual(['/fixture/a.test.ts', '/fixture/b.test.ts']);
  });

  it('dispatches the real collected nested set with the nested timeout', async () => {
    const { nested } = collectBackendTestFiles();

    const calls: Array<{ file: string; timeoutMs: number }> = [];
    const mockRunner = async (file: string, timeoutMs: number) => {
      calls.push({ file, timeoutMs });
      return { code: 0, output: '' };
    };

    const result = await runLanes({
      lane: 'nested',
      fast: [],
      serial: [],
      nested,
      concurrency: 2,
      timeoutMs: 30000,
      nestedTimeoutMs: 900000,
      runner: mockRunner,
    });

    expect(nested.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.file)).toEqual(nested);
    expect(calls.some((c) => c.file.includes('mutation-check.test.ts'))).toBe(true);
    expect(calls.every((c) => c.timeoutMs === 900000)).toBe(true);
  });
});
