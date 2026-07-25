// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordApproachAttempt,
  listApproachAttempts,
  hasAttemptedRung,
  ladderExhausted,
  _closeApproachDb,
  type ApproachAttempt,
  type ApproachRung,
} from '../criterion-approach-store';
import { CRITERION_SERVE_CAP } from '../harness-caps';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'approach-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeApproachDb();
});
afterEach(() => {
  _closeApproachDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('criterion-approach-store', () => {
  test('record and list approach attempts', () => {
    expect(
      recordApproachAttempt({
        criterionId: 'c1',
        missionId: 'm1',
        project: '/p',
        rung: 'fresh-blueprint',
        epicId: 'e1',
        outcome: 'attempted',
        detail: 'tried it',
        attemptedAt: 1000,
      }),
    ).toBe(true);

    const attempts = listApproachAttempts('/p', 'c1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'attempted',
      detail: 'tried it',
      attemptedAt: 1000,
    });
  });

  test('on-conflict update: re-recording same (criterionId, rung, epicId) updates the outcome', () => {
    recordApproachAttempt({
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'attempted',
      detail: 'first try',
      attemptedAt: 1000,
    });

    recordApproachAttempt({
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'failed',
      detail: 'second try failed',
      attemptedAt: 2000,
    });

    const attempts = listApproachAttempts('/p', 'c1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'failed',
      detail: 'second try failed',
      attemptedAt: 2000,
    });
  });

  test('ladderExhausted returns exhausted:false with missing re-decompose on fresh start', () => {
    const result = ladderExhausted({
      attempts: [],
      servedEpicCount: 0,
    });
    expect(result.exhausted).toBe(false);
    expect(result.tried).toEqual([]);
    expect(result.missing).toEqual(['fresh-blueprint', 'tier-bump', 're-decompose']);
  });

  test('ladderExhausted returns exhausted:true when re-decompose has been attempted', () => {
    const freshBlueprint: ApproachAttempt = {
      id: 'id1',
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'attempted',
      detail: null,
      attemptedAt: 1000,
    };

    const reDecompose: ApproachAttempt = {
      id: 'id2',
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 're-decompose',
      epicId: null,
      outcome: 'not-applicable',
      detail: null,
      attemptedAt: 3000,
    };

    const result = ladderExhausted({
      attempts: [freshBlueprint, reDecompose],
      servedEpicCount: 0,
    });
    expect(result.exhausted).toBe(true);
    expect(result.tried).toEqual(['fresh-blueprint', 're-decompose']);
    expect(result.missing).toEqual(['tier-bump']);
  });

  test('ladderExhausted backstop: exhausted when servedEpicCount >= CRITERION_SERVE_CAP + 1', () => {
    const result = ladderExhausted({
      attempts: [],
      servedEpicCount: CRITERION_SERVE_CAP + 1,
    });
    expect(result.exhausted).toBe(true);
    expect(result.tried).toEqual([]);
    expect(result.missing).toEqual(['fresh-blueprint', 'tier-bump', 're-decompose']);
  });

  test('degradation: error on openDb returns empty results', () => {
    _closeApproachDb();
    // Make MERMAID_SUPERVISOR_DIR point to a file, not a directory
    const filePath = join(dir, 'file.txt');
    writeFileSync(filePath, 'test');
    process.env.MERMAID_SUPERVISOR_DIR = filePath;

    expect(
      recordApproachAttempt({
        criterionId: 'c1',
        missionId: 'm1',
        project: '/p',
        rung: 'fresh-blueprint',
        epicId: 'e1',
        outcome: 'attempted',
        detail: null,
        attemptedAt: 1000,
      }),
    ).toBe(false);

    expect(listApproachAttempts('/p', 'c1')).toEqual([]);
    expect(hasAttemptedRung('/p', 'c1', 'fresh-blueprint')).toBe(false);
  });

  test('hasAttemptedRung probes for existence', () => {
    recordApproachAttempt({
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'tier-bump',
      epicId: 'e2',
      outcome: 'attempted',
      detail: null,
      attemptedAt: 1500,
    });

    expect(hasAttemptedRung('/p', 'c1', 'tier-bump')).toBe(true);
    expect(hasAttemptedRung('/p', 'c1', 'fresh-blueprint')).toBe(false);
    expect(hasAttemptedRung('/p', 'c1', 're-decompose')).toBe(false);
  });

  test('epicId normalization: null becomes empty string on write, back to null on read', () => {
    recordApproachAttempt({
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 're-decompose',
      epicId: null,
      outcome: 'not-applicable',
      detail: null,
      attemptedAt: 3000,
    });

    const attempts = listApproachAttempts('/p', 'c1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.epicId).toBeNull();
  });

  test('inferredRungs are merged into tried without DB access', () => {
    const freshBlueprint: ApproachAttempt = {
      id: 'id1',
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'attempted',
      detail: null,
      attemptedAt: 1000,
    };

    const result = ladderExhausted({
      attempts: [freshBlueprint],
      servedEpicCount: 0,
      inferredRungs: ['tier-bump'],
    });
    expect(result.tried).toEqual(['fresh-blueprint', 'tier-bump']);
    expect(result.missing).toEqual(['re-decompose']);
    expect(result.exhausted).toBe(false);
  });
});
