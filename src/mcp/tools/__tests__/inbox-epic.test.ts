// Runs via `bun test` (bun:sqlite). Auto-parent invariant: every work todo lands
// under an epic (constraint 373a2d52) — orphans get the project's Inbox epic.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSessionTodo, INBOX_EPIC_TITLE } from '../session-todos';
import { listTodos, getTodo, createTodo, updateTodo, _closeProject } from '../../../services/todo-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'inbox-epic-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

describe('addSessionTodo auto-parents orphans under the Inbox epic', () => {
  test('an orphan work todo gets parented under a freshly-created Inbox epic', async () => {
    const t = await addSessionTodo(project, 's1', 'do a thing');
    expect(t.parentId).toBeTruthy();
    const parent = getTodo(project, t.parentId!);
    expect(parent?.title).toBe(INBOX_EPIC_TITLE);
  });

  test('a second orphan reuses the SAME Inbox epic (no duplicates)', async () => {
    const a = await addSessionTodo(project, 's1', 'first');
    const b = await addSessionTodo(project, 's1', 'second');
    expect(a.parentId).toBe(b.parentId);
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => t.title === INBOX_EPIC_TITLE);
    expect(inboxes.length).toBe(1);
  });

  test('an epic ([EPIC] …) is NOT auto-parented — epics are roots', async () => {
    const epic = await addSessionTodo(project, 's1', '[EPIC] Real Work');
    expect(epic.parentId == null).toBe(true);
  });

  test('an explicit parentId is respected (no Inbox)', async () => {
    const epic = await addSessionTodo(project, 's1', '[EPIC] Container');
    const child = await addSessionTodo(project, 's1', 'child', undefined, { parentId: epic.id });
    expect(child.parentId).toBe(epic.id);
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => t.title === INBOX_EPIC_TITLE);
    expect(inboxes.length).toBe(0); // never needed an Inbox
  });

  test('a done Inbox is reopened (not duplicated) when a new orphan arrives', async () => {
    // Create an orphan to establish the Inbox, then mark the Inbox done.
    const first = await addSessionTodo(project, 's1', 'first task');
    const inboxId = first.parentId!;
    await updateTodo(project, inboxId, { status: 'done' });

    // A new orphan should reopen the done Inbox, not create a second one.
    const second = await addSessionTodo(project, 's1', 'second task');
    expect(second.parentId).toBe(inboxId); // same Inbox, not a new one

    const inboxes = listTodos(project, { includeCompleted: true }).filter(
      (t) => t.title === INBOX_EPIC_TITLE,
    );
    expect(inboxes.length).toBe(1); // still exactly one Inbox
    expect(inboxes[0].status).not.toBe('done'); // reopened
  });

  test('a live Inbox is returned as-is even when a done Inbox also exists', async () => {
    // Done Inbox (older row).
    await createTodo(project, { ownerSession: 's1', title: INBOX_EPIC_TITLE, status: 'done' });
    // Live Inbox (newer row).
    const live = await createTodo(project, { ownerSession: 's1', title: INBOX_EPIC_TITLE });

    const orphan = await addSessionTodo(project, 's1', 'orphan');
    expect(orphan.parentId).toBe(live.id); // prefers the live one
  });
});
