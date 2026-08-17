import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIBLING_COLLISION_HOLD, holdOutcomeFor } from '../conductor-hold-classification.js';
import { CONDUCTOR_PASS_OUTCOME_CLASS, classifyConductorPassOutcome } from '../conductor-pass-outcome-class.js';
import { openPassRow, finalizePassRow, listConductorPasses, _closeConductorJournalDb } from '../conductor-pass-journal.js';
import { conductorFingerprint } from '../conductor-signature.js';
import {
  collectMissionStatusFacts, deriveCriterionAction, deriveMissionStatus, upsertMission, addCriterion, getMission,
  _resetMissionDbCache,
} from '../mission-store.js';
import { createTodo, updateTodo, _closeProject } from '../todo-store.js';

describe('conductor-hold-classification', () => {
  it('maps the sibling-collision hold reason to the held outcome', () => {
    expect(SIBLING_COLLISION_HOLD).toBe('sibling-collision');
    expect(holdOutcomeFor(SIBLING_COLLISION_HOLD)).toBe('held');
  });

  it('returns null for every other held reason', () => {
    expect(holdOutcomeFor('manual')).toBeNull();
    expect(holdOutcomeFor('retry-exhausted')).toBeNull();
    expect(holdOutcomeFor('migrated-park')).toBeNull();
    expect(holdOutcomeFor('dup-of-landed:abc12345')).toBeNull();
    expect(holdOutcomeFor(null)).toBeNull();
  });

  it('classifies the held pass outcome as stuck', () => {
    // Verify 'held' is an own key of the class table
    expect(Object.prototype.hasOwnProperty.call(CONDUCTOR_PASS_OUTCOME_CLASS, 'held')).toBe(true);
    // Verify it classifies as 'stuck'
    expect(classifyConductorPassOutcome('held')).toBe('stuck');
  });
});

/** Run `fn` against a throwaway project + supervisor dir. */
async function withProject(prefix: string, fn: (proj: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  const proj = join(dir, 'p');
  try {
    await fn(proj);
  } finally {
    _closeProject(proj);
    _resetMissionDbCache(proj);
    _closeConductorJournalDb();
    if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
    else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('held outcome and fingerprint', () => {
  it('a sibling-collision hold records outcome held', async () => {
    await withProject('hold-outcome-', async (proj) => {
      const missionId = 'test-mission-' + Math.random().toString(36).slice(2, 9);
      const rowId = openPassRow(proj, missionId, Date.now())!;
      expect(rowId).toBeDefined();

      // Finalize the row with a held outcome
      const heldOutcome = holdOutcomeFor(SIBLING_COLLISION_HOLD)!;
      const success = finalizePassRow(rowId, {
        outcome: heldOutcome,
        ran: true,
        outcomeClass: classifyConductorPassOutcome('held'),
      });
      expect(success).toBe(true);

      // Read the row back and verify
      const rows = listConductorPasses(proj);
      const row = rows.find((r) => r.id === rowId);
      expect(row).toBeDefined();
      expect(row!.outcome).toBe('held');

      // Verify 'held' is an own key and classifies correctly
      expect(Object.prototype.hasOwnProperty.call(CONDUCTOR_PASS_OUTCOME_CLASS, 'held')).toBe(true);
      expect(classifyConductorPassOutcome('held')).toBe('stuck');
    });
  });

  it('a held outcome changes the mission fingerprint', async () => {
    await withProject('hold-fingerprint-', async (proj) => {
      // Build mission → criterion → serving epic → leaf
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] HF', kind: 'mission' });
      upsertMission(proj, m.id);
      const c = addCriterion(proj, m.id, 'the held outcome shifts the fingerprint');

      const epic = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] serving epic', kind: 'epic', parentId: m.id, servesCriterionIds: [c.id] });
      const leaf = await createTodo(proj, { ownerSession: 's1', title: 'leaf held on collision', kind: 'leaf', parentId: epic.id });

      // Read facts before hold — expect rejectedParkedCount === 0
      const missionBefore = getMission(proj, m.id)!;
      const factsBefore = collectMissionStatusFacts(proj, missionBefore);
      const cfBefore = factsBefore.criteria.find((cc) => cc.id === c.id)!;
      expect(cfBefore.rejectedParkedCount).toBe(0);

      // Build the before fingerprint
      const statusBefore = deriveMissionStatus(factsBefore);
      const actionBefore = deriveCriterionAction(cfBefore);
      const fpBefore = conductorFingerprint(statusBefore, [{ id: c.id, action: actionBefore, rejectedParked: cfBefore.rejectedParkedCount }]);

      // Hold the leaf on a sibling collision
      await updateTodo(proj, leaf.id, {
        heldAt: new Date().toISOString(),
        heldReason: SIBLING_COLLISION_HOLD,
      });

      // Re-read facts after hold — expect rejectedParkedCount === 1
      const missionAfter = getMission(proj, m.id)!;
      const factsAfter = collectMissionStatusFacts(proj, missionAfter);
      const cfAfter = factsAfter.criteria.find((cc) => cc.id === c.id)!;
      expect(cfAfter.rejectedParkedCount).toBe(1);

      // Build the after fingerprint
      const statusAfter = deriveMissionStatus(factsAfter);
      const actionAfter = deriveCriterionAction(cfAfter);
      expect(actionAfter).toBe(actionBefore); // action unchanged
      const fpAfter = conductorFingerprint(statusAfter, [{ id: c.id, action: actionAfter, rejectedParked: cfAfter.rejectedParkedCount }]);

      // Assert the fingerprint changed
      expect(fpAfter).not.toBe(fpBefore);
    });
  });
});
