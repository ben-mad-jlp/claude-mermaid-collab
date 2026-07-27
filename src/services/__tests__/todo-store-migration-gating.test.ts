import Database from 'bun:sqlite';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createTodo,
  openDb,
  _closeProject,
  TODO_TITLE_PREFIX_V9,
} from '../todo-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-store-migration-gating-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

function dbPath(p: string): string {
  return join(p, '.collab', 'todos.db');
}

describe('Migration gating — idempotence and convergence', () => {
  test('second open executes zero backfill UPDATEs (probe rows byte-identical)', async () => {
    // 1. Build a DB with an epic, a leaf, and a done land-leaf child.
    const epic = await createTodo(project, {
      kind: 'epic',
      title: 'Test epic',
      ownerSession: 's',
    });
    const leaf = await createTodo(project, {
      kind: 'leaf',
      title: 'Test leaf',
      ownerSession: 's',
      parentId: epic.id,
    });
    const landLeaf = await createTodo(project, {
      kind: 'land',
      title: 'Land leaf',
      ownerSession: 's',
      parentId: epic.id,
      status: 'done',
    });

    // 2. Close the DB and re-open with raw Database to mutate probe rows.
    _closeProject(project);
    const rawDb = new Database(dbPath(project));

    // Snapshot original probe rows before mutation.
    const epicBefore = rawDb.query(`SELECT id, targetProject, landedAt, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(epic.id) as any;
    const leafBefore = rawDb.query(`SELECT id, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(leaf.id) as any;

    // 3. Mutate probe rows into states the old backfills WOULD rewrite.
    // (These mutations simulate what an old DB might have before the gating.)
    rawDb.prepare(`UPDATE todos SET targetProject = NULL WHERE id = ?`).run(epic.id);
    rawDb.prepare(`UPDATE todos SET landedAt = NULL WHERE id = ?`).run(epic.id);
    rawDb.prepare(`UPDATE todos SET title = ? WHERE id = ?`).run('[EPIC] Probe', epic.id);
    rawDb.prepare(`UPDATE todos SET claimedBy = 'stale', claimToken = 'stale' WHERE id = ? AND status != 'in_progress'`).run(leaf.id);

    // Snapshot the mutated state.
    const epicMutated = rawDb.query(`SELECT id, targetProject, landedAt, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(epic.id) as any;
    const leafMutated = rawDb.query(`SELECT id, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(leaf.id) as any;

    rawDb.close();

    // 4. Re-open via openDb (cache was dropped, so migration block would re-run, but user_version
    // is already high, so backfills are gated and do NOT run).
    openDb(project);

    // 5. Verify probe rows are UNCHANGED (the second open was a no-op due to gating).
    // Open a fresh DB handle to query the current state.
    const freshDb = new Database(dbPath(project));
    const epicFinal = freshDb.query(`SELECT id, targetProject, landedAt, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(epic.id) as any;
    const leafFinal = freshDb.query(`SELECT id, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(leaf.id) as any;

    // The key assertion: probe columns MUST be unchanged after the second open because
    // backfills are gated and don't re-run.
    expect(epicFinal.targetProject).toBe(epicMutated.targetProject); // NULL unchanged
    expect(epicFinal.landedAt).toBe(epicMutated.landedAt); // NULL unchanged
    expect(epicFinal.title).toBe(epicMutated.title); // '[EPIC] Probe' unchanged
    expect(leafFinal.claimedBy).toBe(leafMutated.claimedBy); // 'stale' unchanged
    expect(leafFinal.claimToken).toBe(leafMutated.claimToken); // 'stale' unchanged

    freshDb.close();
  });

  test('legacy user_version=0 DB converges to final state with V9', async () => {
    // 1. Create a DB via openDb, then close and reset to user_version=0 with legacy-shaped rows.
    const epic = await createTodo(project, {
      kind: 'epic',
      title: 'Legacy epic',
      ownerSession: 's',
    });
    const leaf = await createTodo(project, {
      kind: 'leaf',
      title: 'Legacy leaf',
      ownerSession: 's',
      parentId: epic.id,
    });
    const landLeaf = await createTodo(project, {
      kind: 'land',
      title: 'Land leaf',
      ownerSession: 's',
      parentId: epic.id,
      status: 'done',
    });

    _closeProject(project);
    const rawDb = new Database(dbPath(project));

    // 2. Rewrite rows into legacy shape: NULL kind, title prefixes, NULL targetProject, stale claim.
    rawDb.prepare(`UPDATE todos SET kind = NULL WHERE id = ?`).run(epic.id);
    rawDb.prepare(`UPDATE todos SET kind = NULL WHERE id = ?`).run(leaf.id);
    rawDb.prepare(`UPDATE todos SET kind = NULL WHERE id = ?`).run(landLeaf.id);
    rawDb.prepare(`UPDATE todos SET title = ? WHERE id = ?`).run('[EPIC] Legacy epic', epic.id);
    rawDb.prepare(`UPDATE todos SET title = ? WHERE id = ?`).run('[LAND] Land leaf', landLeaf.id);
    rawDb.prepare(`UPDATE todos SET targetProject = NULL WHERE id IN (?, ?, ?)`).run(epic.id, leaf.id, landLeaf.id);
    rawDb.prepare(`UPDATE todos SET claimedBy = 'stale', claimToken = 'old', claimedAt = '2025-01-01T00:00:00Z', claimLeaseMs = 1000, claim = NULL WHERE id = ? AND status != 'in_progress'`).run(leaf.id);

    // 3. Set user_version to 0 to force re-run of all backfills.
    rawDb.exec(`PRAGMA user_version = 0`);
    rawDb.close();

    // 4. Re-open via openDb (all backfills V1–V9 run).
    openDb(project);

    // 5. Verify convergence: exact post-change state.
    const freshDb = new Database(dbPath(project));

    // Check kinds: mission/epic/land/gate/leaf
    const epicFinal = freshDb.query(`SELECT id, kind, title, targetProject, landedAt, status, claimedBy, claimToken FROM todos WHERE id = ?`).get(epic.id) as any;
    const leafFinal = freshDb.query(`SELECT id, kind, title, targetProject, status, claimedBy, claimToken FROM todos WHERE id = ?`).get(leaf.id) as any;
    const landLeafFinal = freshDb.query(`SELECT id, kind, title, status, completedAt FROM todos WHERE id = ?`).get(landLeaf.id) as any;

    // Kinds should be correctly inferred.
    expect(epicFinal.kind).toBe('epic');
    expect(leafFinal.kind).toBe('leaf');
    expect(landLeafFinal.kind).toBe('land');

    // Titles should be stripped of all prefixes.
    expect(epicFinal.title).not.toMatch(/^\[MISSION\]/);
    expect(epicFinal.title).not.toMatch(/^\[EPIC\]/);
    expect(leafFinal.title).not.toMatch(/^\[/);
    expect(landLeafFinal.title).not.toMatch(/^\[LAND\]/);

    // targetProject should be stamped (except on bucket rows which V7 skips).
    expect(epicFinal.targetProject).toBeDefined();
    expect(epicFinal.targetProject).not.toBeNull();
    expect(leafFinal.targetProject).toBe(epicFinal.targetProject);

    // landedAt should be stamped on the done epic.
    expect(epicFinal.landedAt).toBe(landLeafFinal.completedAt);

    // Claim columns should be cleared.
    expect(leafFinal.claimedBy).toBeNull();
    expect(leafFinal.claimToken).toBeNull();

    // Check final user_version.
    const versionResult = freshDb.query(`PRAGMA user_version`).get() as any;
    expect(versionResult.user_version).toBe(TODO_TITLE_PREFIX_V9);

    freshDb.close();
  });
});
