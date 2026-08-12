/**
 * The move to the consolidated database must happen by itself, on every machine, exactly once.
 *
 * Databases are gitignored and never travel with the repo, so a machine that pulls this code
 * meets its OWN legacy todos.db + mission.db. Nobody is going to run a migration command there.
 * These tests pin the opener's contract: it imports on first use, does not import twice, resumes
 * an interrupted first run, leaves the legacy files as the rollback, and enforces the constraints
 * that the whole consolidation exists to make enforceable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openCollabDb, closeCollabDb, _closeAllCollabDbs, lastImportReport } from '../collab-db';

let root: string;
const made: string[] = [];

/** A legacy project: todos.db with a mission node + child leaf, and mission.db with a criterion. */
function legacyProject(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'collab-open-')));
  made.push(p);
  mkdirSync(join(p, '.collab'), { recursive: true });

  const todos = new Database(join(p, '.collab', 'todos.db'), { create: true });
  todos.exec(`CREATE TABLE todos (
    id TEXT PRIMARY KEY, ownerSession TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    dependsOn TEXT NOT NULL, ord REAL NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    retryCount INTEGER NOT NULL, assigneeKind TEXT NOT NULL, isBucket INTEGER NOT NULL,
    reserveCount INTEGER NOT NULL, baseMovedRefunds INTEGER NOT NULL, baseRepair INTEGER NOT NULL,
    kind TEXT, parentId TEXT)`);
  const ins = todos.prepare(
    `INSERT INTO todos (id,ownerSession,title,status,dependsOn,ord,createdAt,updatedAt,retryCount,
                        assigneeKind,isBucket,reserveCount,baseMovedRefunds,baseRepair,kind,parentId)
     VALUES (?,?,?,?,'[]',1,'t','t',0,'agent',0,0,0,0,?,?)`);
  ins.run('m1', 's', 'mission', 'todo', 'mission', null);
  ins.run('l1', 's', 'leaf', 'todo', 'leaf', 'm1');
  ins.run('orphan', 's', 'orphaned child', 'todo', 'leaf', 'long-gone-parent');
  todos.exec('PRAGMA user_version = 11');
  todos.close();

  const mission = new Database(join(p, '.collab', 'mission.db'), { create: true });
  mission.exec(`CREATE TABLE mission (todoId TEXT PRIMARY KEY, createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL, lastNudgeAt INTEGER, active INTEGER NOT NULL DEFAULT 1,
      abandonedAt INTEGER, budgetUsd REAL, lastNudgeKey TEXT, handoffDocId TEXT,
      awaitingApprovalSince INTEGER, lastConductorKey TEXT, archivedAt INTEGER, queuePos INTEGER,
      lastConductorPassAt INTEGER, lastConductorSelfKey TEXT, closedAt INTEGER,
      lastConductorTimeoutKey TEXT, forgeState TEXT);
    CREATE TABLE mission_criterion (id TEXT PRIMARY KEY, todoId TEXT NOT NULL, text TEXT NOT NULL,
      met INTEGER NOT NULL DEFAULT 0, "order" INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL,
      evidence TEXT, verifiedBy TEXT, verifiedAt INTEGER, verifiedAtSha TEXT, evidencePaths TEXT,
      reopenCount INTEGER NOT NULL DEFAULT 0, lastReopenSha TEXT, type TEXT NOT NULL DEFAULT 'capability',
      dependsOn TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', droppedReason TEXT,
      droppedAt INTEGER, droppedBy TEXT, verifyAttemptCount INTEGER NOT NULL DEFAULT 0,
      serveAttemptCount INTEGER NOT NULL DEFAULT 0, nickname TEXT, measurementPendingUntil INTEGER,
      reArmCount INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE mission_recheck (criterionId TEXT PRIMARY KEY, todoId TEXT NOT NULL,
      reason TEXT NOT NULL, landedSha TEXT, enqueuedAt INTEGER NOT NULL);
    CREATE TABLE mission_criterion_verdict_history (id TEXT PRIMARY KEY, criterionId TEXT NOT NULL,
      todoId TEXT NOT NULL, met INTEGER NOT NULL, evidence TEXT, verifiedBy TEXT, verifiedAt INTEGER,
      verifiedAtSha TEXT, evidencePaths TEXT, clearedAt INTEGER NOT NULL, clearReason TEXT, reopenSha TEXT)`);
  mission.prepare('INSERT INTO mission (todoId, createdAt, updatedAt, active) VALUES (?,?,?,1)').run('m1', 1, 1);
  mission.prepare('INSERT INTO mission_criterion (id, todoId, text, updatedAt) VALUES (?,?,?,?)').run('c1', 'm1', 'crit', 1);
  mission.close();
  return p;
}

beforeEach(() => { root = legacyProject(); });
afterEach(() => {
  _closeAllCollabDbs();
  while (made.length) { try { rmSync(made.pop()!, { recursive: true, force: true }); } catch { /* ignore */ } }
});

describe('first open migrates by itself', () => {
  it('imports the legacy pair and serves the work-graph', () => {
    const db = openCollabDb(root);
    expect((db.query('SELECT COUNT(*) c FROM todos').get() as { c: number }).c).toBe(3);
    expect((db.query('SELECT COUNT(*) c FROM mission').get() as { c: number }).c).toBe(1);
    expect((db.query('SELECT COUNT(*) c FROM mission_criterion').get() as { c: number }).c).toBe(1);
    expect(existsSync(join(root, '.collab', 'collab.db'))).toBe(true);
  });

  it('LEAVES the legacy files in place as the rollback', () => {
    openCollabDb(root);
    expect(existsSync(join(root, '.collab', 'todos.db'))).toBe(true);
    expect(existsSync(join(root, '.collab', 'mission.db'))).toBe(true);
  });

  it('severs a dangling parent edge and records it rather than dropping the row', () => {
    const db = openCollabDb(root);
    const orphan = db.query('SELECT parentId FROM todos WHERE id=?').get('orphan') as { parentId: string | null };
    expect(orphan.parentId).toBeNull();          // edge cut so the FK holds
    const noted = db.query('SELECT lost_value FROM migration_orphan WHERE id=?').get('orphan') as { lost_value: string };
    expect(noted.lost_value).toBe('long-gone-parent'); // and written down, not silently lost
    expect(lastImportReport(root)?.severedParents.length).toBe(1);
  });

  it('carries user_version across so the store backfills do not re-run', () => {
    const db = openCollabDb(root);
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(11);
  });

  it('does not import twice', () => {
    openCollabDb(root);
    closeCollabDb(root);
    const db = openCollabDb(root); // second open: destination exists, so no import
    expect((db.query('SELECT COUNT(*) c FROM todos').get() as { c: number }).c).toBe(3);
    expect((db.query('SELECT COUNT(*) c FROM migration_orphan').get() as { c: number }).c).toBe(1);
  });
});

describe('the constraints are live on the opened handle', () => {
  it('foreign keys ENFORCE (they are per-connection and default OFF)', () => {
    const db = openCollabDb(root);
    expect(() =>
      db.prepare('INSERT INTO mission (todoId, createdAt, updatedAt, active) VALUES (?,?,?,1)').run('ghost', 1, 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('a claim cannot outlive its leaf', () => {
    const db = openCollabDb(root);
    db.prepare('INSERT INTO leaf_claim (leafId, holder, acquiredAt, expiresAt, heartbeatAt) VALUES (?,?,?,?,?)')
      .run('l1', 'w', 1, 999, 1);
    db.prepare('DELETE FROM todos WHERE id=?').run('l1');
    expect((db.query('SELECT COUNT(*) c FROM leaf_claim').get() as { c: number }).c).toBe(0);
  });
});

describe('handle caching keys on the canonical root', () => {
  it('two spellings share one handle', () => {
    expect(openCollabDb(root + '/')).toBe(openCollabDb(root));
  });

  it('an agent-session worktree resolves to the tracking repo handle', () => {
    const wt = join(root, '.collab', 'agent-sessions', 'worktrees', 'leaf-exec-1');
    mkdirSync(wt, { recursive: true });
    expect(openCollabDb(wt)).toBe(openCollabDb(root));
  });

  it('closing by a different spelling still evicts', () => {
    const first = openCollabDb(root);
    closeCollabDb(root + '/');
    expect(openCollabDb(root)).not.toBe(first);
  });
});

describe('a project with no legacy data', () => {
  it('creates an empty consolidated database without an import', () => {
    const fresh = realpathSync(mkdtempSync(join(tmpdir(), 'collab-fresh-')));
    made.push(fresh);
    mkdirSync(join(fresh, '.collab'), { recursive: true });
    const db = openCollabDb(fresh);
    expect((db.query('SELECT COUNT(*) c FROM todos').get() as { c: number }).c).toBe(0);
    expect(lastImportReport(fresh)).toBeUndefined(); // nothing to import, so nothing claimed
  });
});
