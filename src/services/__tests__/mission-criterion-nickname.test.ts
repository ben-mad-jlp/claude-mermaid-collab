// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject } from '../todo-store';
import { addCriterion, listCriteria, _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import Database from 'bun:sqlite';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-nickname-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-store: criterion nickname', () => {
  test('a freshly added criterion has a non-empty 2-4 word hyphenated nickname', async () => {
    const missionId = await makeMissionNode();
    const c = addCriterion(project, missionId, 'Some multi word title');
    expect(c.nickname).not.toBe('');
    expect(c.nickname).toMatch(/^[a-z0-9]+(-[a-z0-9]+){1,3}$/);
  });

  test('two criteria with the same text on one mission get different nicknames', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'Some multi word title');
    const b = addCriterion(project, missionId, 'Some multi word title');
    expect(b.nickname).not.toBe(a.nickname);
    expect(b.nickname).toBe(`${a.nickname}-2`);
  });

  test('a fresh openDb backfills NULL nickname rows to non-empty', async () => {
    const missionId = await makeMissionNode();
    addCriterion(project, missionId, 'First criterion here');
    addCriterion(project, missionId, 'Second criterion here');

    // Force every nickname to NULL directly on the sqlite file, then evict the
    // cached handle so the next store call re-runs openDb's backfill migration.
    const db = new Database(join(project, '.collab', 'mission.db'));
    db.exec("UPDATE mission_criterion SET nickname = NULL");
    db.close();
    _resetMissionDbCache(project);

    const rows = listCriteria(project, missionId);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.nickname).not.toBe('');
      expect(r.nickname).toBeTruthy();
    }
    expect(rows[0].nickname).not.toBe(rows[1].nickname);
  });
});
