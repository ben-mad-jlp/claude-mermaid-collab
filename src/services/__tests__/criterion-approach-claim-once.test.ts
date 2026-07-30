// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimApproachRungOnce,
  listApproachAttempts,
  ladderExhausted,
  _closeApproachDb,
} from '../criterion-approach-store';
import { CRITERION_SERVE_CAP } from '../harness-caps';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'approach-claim-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeApproachDb();
});
afterEach(() => {
  _closeApproachDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('claimApproachRungOnce', () => {
  test('five sequential claims on the same slot return true then false four times, one row persists', () => {
    const base = {
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'test-only-close' as const,
      epicId: 'sha:abc',
      outcome: 'attempted' as const,
      detail: null,
    };
    const results = [0, 1, 2, 3, 4].map((i) =>
      claimApproachRungOnce({ ...base, attemptedAt: 1000 + i }),
    );
    expect(results).toEqual([true, false, false, false, false]);
    expect(listApproachAttempts('/p', 'c1')).toHaveLength(1);
  });

  test('a different sha slot claims independently and yields a second row', () => {
    const base = {
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'test-only-close' as const,
      outcome: 'attempted' as const,
      detail: null,
    };
    claimApproachRungOnce({ ...base, epicId: 'sha:abc', attemptedAt: 1000 });
    const secondSlot = claimApproachRungOnce({ ...base, epicId: 'sha:def', attemptedAt: 1001 });
    expect(secondSlot).toBe(true);
    expect(listApproachAttempts('/p', 'c1')).toHaveLength(2);
  });

  test('ladderExhausted over attempts containing only test-only-close matches ladderExhausted over empty attempts', () => {
    claimApproachRungOnce({
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'test-only-close',
      epicId: 'sha:abc',
      outcome: 'attempted',
      detail: null,
      attemptedAt: 1000,
    });
    const attempts = listApproachAttempts('/p', 'c1');
    expect(attempts).toHaveLength(1);

    for (const servedEpicCount of [0, CRITERION_SERVE_CAP]) {
      const withRow = ladderExhausted({ attempts, servedEpicCount });
      const withoutRow = ladderExhausted({ attempts: [], servedEpicCount });
      expect(withRow).toEqual(withoutRow);
    }
  });
});
