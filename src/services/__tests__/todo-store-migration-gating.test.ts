import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createTodo,
  openDb,
  _closeProject,
  TODO_EXPLORE_SPEC_V11,
} from '../todo-store';

// Every handle here comes from openDb — the store's consolidated `.collab/collab.db`. The probe
// rows are mutated through that same handle rather than a second raw `new Database`, because a
// raw connection opens with foreign keys OFF (the pragma is per-connection) and would let this
// fixture write graph states the store itself cannot.
//
// GOTCHA that makes or breaks both tests: the one-shot backfill block is guarded by a per-root
// `prepared` set, so openDb only re-runs it on a root whose handle has been evicted. Every
// "re-open" step below is therefore _closeProject() FOLLOWED BY openDb() — dropping the
// _closeProject would hand back the cached handle, the migration block would never execute, and
// the test would pass while proving nothing.

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-store-migration-gating-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

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

    // 2. Take the store's handle to mutate probe rows behind its back.
    const rawDb = openDb(project);

    // 3. Mutate probe rows into states the old backfills WOULD rewrite.
    // (These mutations simulate what an old DB might have before the gating.)
    rawDb.prepare(`UPDATE todos SET targetProject = NULL WHERE id = ?`).run(epic.id);
    rawDb.prepare(`UPDATE todos SET landedAt = NULL WHERE id = ?`).run(epic.id);
    rawDb.prepare(`UPDATE todos SET title = ? WHERE id = ?`).run('[EPIC] Probe', epic.id);
    rawDb.prepare(`UPDATE todos SET claimedBy = 'stale', claimToken = 'stale' WHERE id = ? AND status != 'in_progress'`).run(leaf.id);

    // Snapshot the mutated state.
    const epicMutated = rawDb.query(`SELECT id, targetProject, landedAt, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(epic.id) as any;
    const leafMutated = rawDb.query(`SELECT id, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(leaf.id) as any;

    // 4. Evict, then re-open: the migration block DOES re-run, but user_version is already at the
    // latest marker, so every backfill inside it is gated off.
    _closeProject(project);
    const freshDb = openDb(project);

    // 5. Verify probe rows are UNCHANGED (the second open was a no-op due to gating).
    const epicFinal = freshDb.query(`SELECT id, targetProject, landedAt, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(epic.id) as any;
    const leafFinal = freshDb.query(`SELECT id, title, claimedBy, claimToken FROM todos WHERE id = ?`).get(leaf.id) as any;

    // The key assertion: probe columns MUST be unchanged after the second open because
    // backfills are gated and don't re-run.
    expect(epicFinal.targetProject).toBe(epicMutated.targetProject); // NULL unchanged
    expect(epicFinal.landedAt).toBe(epicMutated.landedAt); // NULL unchanged
    expect(epicFinal.title).toBe(epicMutated.title); // '[EPIC] Probe' unchanged
    expect(leafFinal.claimedBy).toBe(leafMutated.claimedBy); // 'stale' unchanged
    expect(leafFinal.claimToken).toBe(leafMutated.claimToken); // 'stale' unchanged
  });

  test('legacy user_version=0 DB converges to final state at the latest user_version', async () => {
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

    const rawDb = openDb(project);

    // 2. Rewrite rows into legacy shape: NULL kind, title prefixes, NULL targetProject, stale claim.
    rawDb.prepare(`UPDATE todos SET kind = NULL WHERE id = ?`).run(epic.id);
    rawDb.prepare(`UPDATE todos SET kind = NULL WHERE id = ?`).run(leaf.id);
    rawDb.prepare(`UPDATE todos SET kind = NULL WHERE id = ?`).run(landLeaf.id);
    rawDb.prepare(`UPDATE todos SET title = ? WHERE id = ?`).run('[EPIC] Legacy epic', epic.id);
    rawDb.prepare(`UPDATE todos SET title = ? WHERE id = ?`).run('[LAND] Land leaf', landLeaf.id);
    rawDb.prepare(`UPDATE todos SET targetProject = NULL WHERE id IN (?, ?, ?)`).run(epic.id, leaf.id, landLeaf.id);
    rawDb.prepare(`UPDATE todos SET claimedBy = 'stale', claimToken = 'old', claimedAt = '2025-01-01T00:00:00Z', claimLeaseMs = 1000, claim = NULL WHERE id = ? AND status != 'in_progress'`).run(leaf.id);

    // 3. Set user_version to 0 to force re-run of all backfills. This is the same lever the
    // import uses in the other direction — it carries the legacy file's user_version into
    // collab.db precisely so these gates keep their meaning after consolidation.
    rawDb.exec(`PRAGMA user_version = 0`);

    // 4. Evict and re-open via openDb (all backfills V1–V11 run).
    _closeProject(project);
    const freshDb = openDb(project);

    // 5. Verify convergence: exact post-change state.

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

    // Check final user_version — must be the NEWEST migration marker, not merely a
    // historical one. Adding a migration without moving this assertion reds the base
    // gate for every epic project-wide, so this pins the latest constant deliberately.
    const versionResult = freshDb.query(`PRAGMA user_version`).get() as any;
    expect(versionResult.user_version).toBe(TODO_EXPLORE_SPEC_V11);
  });
});
