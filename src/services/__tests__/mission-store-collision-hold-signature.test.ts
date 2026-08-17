/**
 * Regression: collision-held serving-epic leaves count toward rejectedParkedCount and
 * change the conductor debounce fingerprint.
 *
 * The SIBLING_COLLISION_HOLD (conductor-hold-classification.ts) currently has no ledger
 * consumer — a held leaf produces NO ledger run. Without this path, a collision hold stays
 * silent and the debounce fingerprint never changes, so the conductor never wakes to act
 * on the hold. Moving the hold outcome into rejectedParkedCount (a component of
 * buildServeSignature) makes the hold observable as a fingerprint delta.
 */

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectMissionStatusFacts, deriveCriterionAction, upsertMission, addCriterion, getMission,
  _resetMissionDbCache,
} from '../mission-store';
import { createTodo, updateTodo, _closeProject } from '../todo-store';
import { SIBLING_COLLISION_HOLD } from '../conductor-hold-classification';
import { buildServeSignature } from '../conductor-signature';

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
    if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
    else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('collision-hold into rejectedParkedCount', () => {
  test('a collision-held serving-epic leaf makes rejectedParkedCount 1 and changes the fingerprint', async () => {
    await withProject('mission-collision-hold-', async (proj) => {
      // Build mission → criterion → serving epic → leaf
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] CH', kind: 'mission' });
      upsertMission(proj, m.id);
      const c = addCriterion(proj, m.id, 'the collision hold shifts the signature');

      const epic = await createTodo(proj, { ownerSession: 's1', title: '[EPIC] serving epic', kind: 'epic', parentId: m.id, servesCriterionIds: [c.id] });
      const leaf = await createTodo(proj, { ownerSession: 's1', title: 'leaf held on collision', kind: 'leaf', parentId: epic.id });

      // Read facts once — expect rejectedParkedCount === 0
      const missionBefore = getMission(proj, m.id)!;
      const factsBefore = collectMissionStatusFacts(proj, missionBefore);
      const cfBefore = factsBefore.criteria.find((cc) => cc.id === c.id)!;
      expect(cfBefore.rejectedParkedCount).toBe(0);

      // Build the before signature
      const statusBefore = 'needs-discovery'; // mission has no blocked leaves, no landed epic
      const actionBefore = deriveCriterionAction(cfBefore);
      expect(actionBefore).toBe('discover');
      const sigBefore = buildServeSignature({
        status: statusBefore,
        actions: [{ id: c.id, action: actionBefore, rejectedParked: 0 }],
      });

      // Hold the leaf on a sibling collision
      await updateTodo(proj, leaf.id, {
        heldAt: new Date().toISOString(),
        heldReason: SIBLING_COLLISION_HOLD,
      });

      // Re-read facts — expect rejectedParkedCount === 1
      const missionAfter = getMission(proj, m.id)!;
      const factsAfter = collectMissionStatusFacts(proj, missionAfter);
      const cfAfter = factsAfter.criteria.find((cc) => cc.id === c.id)!;
      expect(cfAfter.rejectedParkedCount).toBe(1);

      // Build the after signature
      const statusAfter = 'needs-discovery'; // status unchanged
      const actionAfter = deriveCriterionAction(cfAfter);
      expect(actionAfter).toBe('discover'); // action unchanged
      const sigAfter = buildServeSignature({
        status: statusAfter,
        actions: [{ id: c.id, action: actionAfter, rejectedParked: 1 }],
      });

      // Assert the fingerprint changed
      expect(sigAfter).not.toBe(sigBefore);

      // Assert the format equals the literal expected output: `${status}|${id}:${action}:1`
      const expectedFormat = `${statusAfter}|${c.id}:${actionAfter}:1`;
      expect(sigAfter).toBe(expectedFormat);
    });
  });
});
