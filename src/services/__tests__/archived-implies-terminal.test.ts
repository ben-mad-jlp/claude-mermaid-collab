/**
 * "Archived" and "live" are contradictory states, and the schema used to let them coexist.
 *
 * listTodos hides `archivedAt IS NOT NULL` by default, so an archived row that is still
 * todo/planned/in_progress is work nobody can see — invisible to the UI and to the daemon.
 * MEASURED 2026-08-11: 66 such rows on this project, stamped with a junk epoch.
 *
 * Both directions have to hold, because there are two ways in:
 *   1. archiving something that is not finished
 *   2. reviving something that was archived
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, updateTodo, listTodos, archiveTodosByIds, _closeProject } from '../todo-store';

let project: string;
let epicId: string;

// Every work todo must belong to an epic (todo-store enforces it), so each case needs one.
beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'archived-terminal-'));
  epicId = (await createTodo(project, { ownerSession: 's1', title: 'holder epic', kind: 'epic' })).id;
});
afterEach(() => { try { _closeProject(project); } catch { /* ignore */ } rmSync(project, { recursive: true, force: true }); });

const hotIds = () => listTodos(project, { includeCompleted: true }).map((t) => t.id);

describe('archiving refuses anything still live', () => {
  it('does NOT archive a todo that has not finished', async () => {
    const live = await createTodo(project, { ownerSession: 's1', title: 'still going', parentId: epicId });
    const changed = archiveTodosByIds(project, [live.id], Date.now());

    expect(changed).toBe(0);                 // the shortfall is visible in the count
    expect(hotIds()).toContain(live.id);     // and the row is still findable
  });

  it('archives the finished rows in a mixed batch and leaves the live one alone', async () => {
    const done = await createTodo(project, { ownerSession: 's1', title: 'finished', parentId: epicId });
    await updateTodo(project, done.id, { status: 'done' });
    const live = await createTodo(project, { ownerSession: 's1', title: 'live', parentId: epicId });

    // One live row must not abandon the rest of the batch — the sweep pages in chunks of 500.
    const changed = archiveTodosByIds(project, [done.id, live.id], Date.now());

    expect(changed).toBe(1);
    expect(hotIds()).toContain(live.id);
    expect(hotIds()).not.toContain(done.id);
  });

  it('archives a dropped row — dropped is terminal too, not just done', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'abandoned', parentId: epicId });
    await updateTodo(project, t.id, { status: 'dropped', force: true });

    expect(archiveTodosByIds(project, [t.id], Date.now())).toBe(1);
  });
});

describe('reviving an archived row brings it back into view', () => {
  it('clears archivedAt when a finished row is reopened', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'reopened', parentId: epicId });
    await updateTodo(project, t.id, { status: 'done' });
    archiveTodosByIds(project, [t.id], Date.now());
    expect(hotIds()).not.toContain(t.id);

    const revived = await updateTodo(project, t.id, { status: 'todo' });

    expect(revived.archivedAt).toBeNull();
    // The real symptom: without this, the row is live work hidden from every default view.
    expect(hotIds()).toContain(t.id);
  });

  it('leaves archivedAt intact when the row stays terminal', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'still done', parentId: epicId });
    await updateTodo(project, t.id, { status: 'done' });
    const at = Date.now();
    archiveTodosByIds(project, [t.id], at);

    // Editing an unrelated field must not silently un-archive it.
    const after = await updateTodo(project, t.id, { title: 'still done, renamed' });

    expect(after.archivedAt).toBe(at);
    expect(hotIds()).not.toContain(t.id);
  });
});
