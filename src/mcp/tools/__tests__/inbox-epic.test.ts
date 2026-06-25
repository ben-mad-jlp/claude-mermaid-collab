// Runs via `bun test` (bun:sqlite). Every-todo-needs-an-epic (constraint 373a2d52):
// a non-epic top-level todo is REJECTED — no silent auto-home. The Inbox is EXPLICIT
// (inbox:true) only, for deliberate unplanned thoughts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSessionTodo, INBOX_EPIC_TITLE } from '../session-todos';
import { listTodos, getTodo, _closeProject } from '../../../services/todo-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'inbox-epic-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

describe('every-todo-needs-an-epic: reject orphans, explicit Inbox only', () => {
  test('an orphan work todo (no epic, no inbox) is REJECTED — fails loudly', async () => {
    await expect(addSessionTodo(project, 's1', 'do a thing')).rejects.toThrow(/epic/i);
    // nothing was created — not even a silent Inbox
    const all = listTodos(project, { includeCompleted: true });
    expect(all.length).toBe(0);
  });

  test('inbox:true files under a freshly-created Inbox epic (the ONLY auto-home, explicit)', async () => {
    const t = await addSessionTodo(project, 's1', 'an unplanned thought', undefined, { inbox: true });
    expect(t.parentId).toBeTruthy();
    expect(getTodo(project, t.parentId!)?.title).toBe(INBOX_EPIC_TITLE);
  });

  test('a second inbox:true todo reuses the SAME Inbox epic (no duplicates)', async () => {
    const a = await addSessionTodo(project, 's1', 'first', undefined, { inbox: true });
    const b = await addSessionTodo(project, 's1', 'second', undefined, { inbox: true });
    expect(a.parentId).toBe(b.parentId);
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => t.title === INBOX_EPIC_TITLE);
    expect(inboxes.length).toBe(1);
  });

  test('an epic ([EPIC] …) is a root — no parent required, never rejected', async () => {
    const epic = await addSessionTodo(project, 's1', '[EPIC] Real Work');
    expect(epic.parentId == null).toBe(true);
  });

  test('an explicit parentId is respected (no Inbox, no reject)', async () => {
    const epic = await addSessionTodo(project, 's1', '[EPIC] Container');
    const child = await addSessionTodo(project, 's1', 'child', undefined, { parentId: epic.id });
    expect(child.parentId).toBe(epic.id);
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => t.title === INBOX_EPIC_TITLE);
    expect(inboxes.length).toBe(0); // never needed an Inbox
  });
});
