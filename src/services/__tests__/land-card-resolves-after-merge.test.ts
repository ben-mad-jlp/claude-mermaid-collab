/**
 * Unit tests for landEpic's merge-evidence gate.
 *
 * Ensures that when runMerge returns { ok: true, land: { landed: true } } without
 * a masterSha, the card is NOT resolved and restoreOnFailure is called instead.
 * Mirrors the land-card-nothing-to-merge.test.ts harness: isolates the global
 * supervisor.db via MERMAID_SUPERVISOR_DIR, isolates the per-project todo DB
 * via a temp dir. No real git repo needed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// -----------------------------------------------------------------------
// Isolation: point the global supervisor.db at a temp dir BEFORE the store
// opens it (module initialisation order).
// -----------------------------------------------------------------------
const supDir = mkdtempSync(join(tmpdir(), 'lmec-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import {
  _closeDb,
  listOpenEscalations,
  getEscalation,
  createEscalation,
} from '../supervisor-store';
import { createTodo } from '../todo-store';
import { landEpic } from '../coordinator-land';
import type { LandStageDeps } from '../coordinator-land';

// -----------------------------------------------------------------------
// Per-project todo DB isolation: use a temp directory as the "project path"
// -----------------------------------------------------------------------
const todoBase = mkdtempSync(join(tmpdir(), 'lmec-todos-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------
beforeAll(() => {
  _closeDb();
});
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
});
afterAll(() => {
  _closeDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('landEpic — merge-evidence gate', () => {
  it('leaves the epic-ready-to-land escalation open when no merge commit exists for the epic', async () => {
    const project = freshProject();
    const session = 'test-session';

    // Create a minimal epic with one build-child leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: 'Test Epic',
      kind: 'epic',
      status: 'planned',
    });

    // Create and open an epic-ready-to-land escalation
    const card = createEscalation({
      project,
      session,
      kind: 'epic-ready-to-land',
      questionText: 'Ready to land?',
      todoId: epic.id,
      audience: 'human',
    });

    // Build stubs for all stage dependencies
    const markersFinalizeLandRecord: string[] = [];
    const markersTeardownEpic: string[] = [];
    const markersPostLandGuard: string[] = [];

    const deps: LandStageDeps = {
      checkDirtyTree: async () => ({ ok: true, dirty: [] }) as any,
      runStewardPrecheck: async () => ({ ok: true, epic: null, epicChildIds: [] }) as any,
      checkStaleness: async () => ({ ok: true }) as any,
      runProofStage: async () => ({ ok: true, proof: {} }) as any,
      checkOpenChildren: async () => ({ ok: true }) as any,
      // runMerge returns ok: true with landed: true but NO masterSha
      runMerge: async () => ({
        ok: true,
        land: { landed: true, conflict: false },
      }) as any,
      // These should NOT be reached
      finalizeLandRecord: async () => {
        markersFinalizeLandRecord.push('reached');
        return undefined;
      },
      teardownEpic: async () => {
        markersTeardownEpic.push('reached');
      },
      runPostLandGuard: async () => {
        markersPostLandGuard.push('reached');
        return { ok: true };
      },
    } as unknown as LandStageDeps;

    // Call landEpic with the escalationId
    const res = await landEpic(
      project,
      { escalationId: card.escalation.id },
      undefined,
      deps,
    );

    // Assert that the land was refused with 'no-merge-commit' reason
    expect(res.ok).toBe(false);
    expect(res.landed).toBe(false);
    expect(res.reason).toBe('no-merge-commit');

    // Assert that finalizeLandRecord, teardownEpic were NOT called
    expect(markersFinalizeLandRecord.length).toBe(0);
    expect(markersTeardownEpic.length).toBe(0);
    expect(markersPostLandGuard.length).toBe(0);

    // Assert that the escalation is still open
    const openCards = listOpenEscalations({
      project,
      kind: 'epic-ready-to-land',
    });
    expect(openCards.some((c) => c.id === card.escalation.id)).toBe(true);

    // Assert that the card status is not resolved
    const cardAfter = getEscalation(card.escalation.id);
    expect(cardAfter?.status).not.toBe('resolved');
  });
});
