// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordSweepVerdict, getSweepVerdict, retireSweepVerdict, _resetSweepVerdicts, _closeLedgerDb } from '../worker-ledger';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sweep-verdict-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('sweep_verdict store', () => {
  test('records and reads back a verdict for the exact branch tip', () => {
    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic1', branchTipSha: 'sha-a', verdict: true });
    const got = getSweepVerdict('gc', 'epic1', 'sha-a');
    expect(got).not.toBeNull();
    expect(got!.verdict).toBe(true);
    expect(typeof got!.checkedAt).toBe('number');
  });

  test("a different branch tip is a miss and returns null", () => {
    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic1', branchTipSha: 'sha-a', verdict: true });
    expect(getSweepVerdict('gc', 'epic1', 'sha-b')).toBeNull();
  });

  test('recording a new tip deletes the stale tip row for the same epic and kind', () => {
    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic1', branchTipSha: 'sha-a', verdict: true });
    // A sibling sweep/epic must survive the prune — pruning is scoped to (sweepKind, epicId).
    recordSweepVerdict({ sweepKind: 'other-sweep', epicId: 'epic1', branchTipSha: 'sha-a', verdict: false });
    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic2', branchTipSha: 'sha-a', verdict: false });

    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic1', branchTipSha: 'sha-b', verdict: false });

    expect(getSweepVerdict('gc', 'epic1', 'sha-a')).toBeNull(); // stale tip pruned
    expect(getSweepVerdict('gc', 'epic1', 'sha-b')?.verdict).toBe(false); // new tip present
    expect(getSweepVerdict('other-sweep', 'epic1', 'sha-a')?.verdict).toBe(false); // untouched
    expect(getSweepVerdict('gc', 'epic2', 'sha-a')?.verdict).toBe(false); // untouched
  });

  test('retireSweepVerdict deletes every row for the epic and returns the count', () => {
    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic1', branchTipSha: 'sha-a', verdict: true });
    recordSweepVerdict({ sweepKind: 'gc', epicId: 'epic1', branchTipSha: 'sha-a', verdict: true });
    // Second write above upserts the same (sweepKind, epicId, branchTipSha) row — only one row exists.
    expect(retireSweepVerdict('gc', 'epic1')).toBe(1);
    expect(getSweepVerdict('gc', 'epic1', 'sha-a')).toBeNull();
    expect(retireSweepVerdict('gc', 'epic1')).toBe(0); // nothing left to delete

    _resetSweepVerdicts();
  });
});
