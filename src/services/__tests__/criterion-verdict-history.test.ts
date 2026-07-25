// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, addCriterion, clearCriterionVerdict, setCriterionVerdict,
  listCriterionVerdictHistory, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-verdict-history-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('criterion-verdict-history', () => {
  test('(i) single verdict+clear cycle preserves evidence in history', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    const c = addCriterion(project, missionId, 'Test criterion');

    // Set a verdict with evidence
    setCriterionVerdict(project, c.id, {
      met: true,
      evidence: 'E1',
      verifiedBy: 'judge-1',
      verifiedAtSha: 'sha1',
      evidencePaths: ['src/a.ts'],
    });

    // Clear the verdict
    clearCriterionVerdict(project, c.id, { reason: 'land-diff-intersects-evidence' });

    // Check that live criterion is cleared
    const history = listCriterionVerdictHistory(project, c.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      evidence: 'E1',
      verifiedBy: 'judge-1',
      verifiedAtSha: 'sha1',
      met: true,
      clearReason: 'land-diff-intersects-evidence',
    });
    expect(history[0].evidencePaths).toEqual(['src/a.ts']);
  });

  test('(ii) two verdict+clear cycles maintain reverse chronological order by clearedAt DESC, rowid DESC', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    const c = addCriterion(project, missionId, 'Test criterion');

    // First cycle: E1
    setCriterionVerdict(project, c.id, {
      met: true,
      evidence: 'E1',
      verifiedBy: 'judge-1',
      verifiedAtSha: 'sha1',
      evidencePaths: ['src/a.ts'],
    });
    clearCriterionVerdict(project, c.id, { reason: 'land-diff-intersects-evidence' });

    // Second cycle: E2
    setCriterionVerdict(project, c.id, {
      met: true,
      evidence: 'E2',
      verifiedBy: 'judge-2',
      verifiedAtSha: 'sha2',
      evidencePaths: ['src/b.ts'],
    });
    clearCriterionVerdict(project, c.id, { reason: 'land-diff-intersects-evidence' });

    // Check ordering: [0] = E2, [1] = E1
    const history = listCriterionVerdictHistory(project, c.id);
    expect(history).toHaveLength(2);
    expect(history[0].evidence).toBe('E2');
    expect(history[1].evidence).toBe('E1');
  });

  test('(iii) clearCriterionVerdict on a never-verified criterion produces no history entry', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    const c = addCriterion(project, missionId, 'Test criterion');

    // Never set a verdict, just clear
    clearCriterionVerdict(project, c.id, { reason: 'some-reason' });

    // Check that no history entry was created
    const history = listCriterionVerdictHistory(project, c.id);
    expect(history).toHaveLength(0);
  });

  test('(iv) listCriterionVerdictHistory is importable from mission-store', async () => {
    // This test just verifies the import works (it does if we got here)
    expect(typeof listCriterionVerdictHistory).toBe('function');
  });
});
