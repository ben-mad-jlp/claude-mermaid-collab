// Runs via `bun test` (bun:sqlite). Every-todo-needs-an-epic (constraint 373a2d52):
// a non-epic top-level todo is REJECTED — no silent auto-home. The Inbox is EXPLICIT
// (inbox:true) only, for deliberate unplanned thoughts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSessionTodo, INBOX_EPIC_TITLE } from '../session-todos';
import { listTodos, getTodo, createTodo, updateTodo, _closeProject } from '../../../services/todo-store';
import { isInboxEpicTitle, isInboxEpic } from '../../../services/claimability';

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
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => isInboxEpic(t));
    expect(inboxes.length).toBe(1);
  });

  test('INBOX_EPIC_TITLE is a bare topic name — the [EPIC] role prefix is not stored (stage C)', () => {
    expect(INBOX_EPIC_TITLE).not.toMatch(/^\s*\[(EPIC|MISSION|LAND)\]/);
  });

  test('an epic created with a BARE title is stored kind=epic and is a root (BOMB 1)', async () => {
    const epic = await addSessionTodo(project, 's1', 'Real Work', undefined, { kind: 'epic' });
    expect(epic.parentId == null).toBe(true);
    expect(getTodo(project, epic.id)!.kind).toBe('epic');
  });

  test('a mission created with a BARE title is stored kind=mission and is a root', async () => {
    const mission = await addSessionTodo(project, 's1', 'Converge on X', undefined, { kind: 'mission' });
    expect(mission.parentId == null).toBe(true);
    expect(getTodo(project, mission.id)!.kind).toBe('mission');
  });

  test('a land leaf created with a BARE title is stored kind=land and is parented under an epic', async () => {
    const epic = await addSessionTodo(project, 's1', 'Container', undefined, { kind: 'epic' });
    const land = await addSessionTodo(project, 's1', 'Land X to master', undefined, { kind: 'land', parentId: epic.id });
    expect(getTodo(project, land.id)!.kind).toBe('land');
    expect(land.parentId).toBe(epic.id);
  });

  test('a bare-titled todo with no kind defaults to leaf and is REJECTED as an orphan', async () => {
    await expect(addSessionTodo(project, 's1', 'do a thing')).rejects.toThrow(/epic/i);
    const all = listTodos(project, { includeCompleted: true });
    expect(all.length).toBe(0);
  });

  test('an explicit parentId is respected (no Inbox, no reject)', async () => {
    const epic = await addSessionTodo(project, 's1', 'Container', undefined, { kind: 'epic' });
    const child = await addSessionTodo(project, 's1', 'child', undefined, { parentId: epic.id });
    expect(child.parentId).toBe(epic.id);
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => isInboxEpic(t));
    expect(inboxes.length).toBe(0); // never needed an Inbox
  });

  test('a LEGACY prefixed "[EPIC] Inbox" row is adopted, not duplicated (migration window)', async () => {
    const legacy = await createTodo(project, {
      ownerSession: 's1',
      kind: 'epic',
      title: '[EPIC] Inbox',
    });
    const orphan = await addSessionTodo(project, 's1', 'orphan', undefined, { inbox: true });
    expect(orphan.parentId).toBe(legacy.id); // adopted the legacy row, not a new one

    const epics = listTodos(project, { includeCompleted: true }).filter((t) => isInboxEpic(t));
    expect(epics.length).toBe(1);
    expect(isInboxEpicTitle(epics[0].title)).toBe(true);
  });

  test('a done Inbox is reopened (not duplicated) when a new orphan arrives', async () => {
    // Create an orphan to establish the Inbox, then mark the Inbox done. The container-close guard
    // refuses 'done' while a child is still open, so settle the child first (drop it).
    const first = await addSessionTodo(project, 's1', 'first task', undefined, { inbox: true });
    const inboxId = first.parentId!;
    await updateTodo(project, first.id, { status: 'dropped' });
    await updateTodo(project, inboxId, { status: 'done' });

    // A new orphan should reopen the done Inbox, not create a second one.
    const second = await addSessionTodo(project, 's1', 'second task', undefined, { inbox: true });
    expect(second.parentId).toBe(inboxId); // same Inbox, not a new one

    const inboxes = listTodos(project, { includeCompleted: true }).filter(
      (t) => t.title === INBOX_EPIC_TITLE,
    );
    expect(inboxes.length).toBe(1); // still exactly one Inbox
    expect(inboxes[0].status).not.toBe('done'); // reopened
  });

  // DR-bugfix-bucket-dedupe: exactly one bucket epic of each kind per project. Two coexisting
  // Inboxes (the old "prefer the live one" scenario) can no longer be created — createTodo refuses
  // the second. Legacy-duplicate adoption (prefer-live/reopen-terminal) is covered by
  // bucket-dedupe.test.ts / bucket-registry.test.ts; here we assert the create-time guard.
  test('a second Inbox bucket is refused (exactly one per project); orphans resolve to the one', async () => {
    const firstInbox = await createTodo(project, { ownerSession: 's1', kind: 'epic', title: INBOX_EPIC_TITLE });
    await expect(
      createTodo(project, { ownerSession: 's1', kind: 'epic', title: INBOX_EPIC_TITLE }),
    ).rejects.toThrow(/already exists|Exactly one bucket/i);

    const orphan = await addSessionTodo(project, 's1', 'orphan', undefined, { inbox: true });
    expect(orphan.parentId).toBe(firstInbox.id); // resolves to the single Inbox
    const inboxes = listTodos(project, { includeCompleted: true }).filter((t) => t.title === INBOX_EPIC_TITLE);
    expect(inboxes.length).toBe(1);
  });
});
