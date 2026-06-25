// Runs via `bun test` (uses bun:sqlite via todo-store) — excluded from vitest (Node).
//
// Covers the event-driven claim path: the orchestrator-kick seam (decouples the
// todo-store from orchestrator-live to avoid an import cycle) and the todo-store
// mutation sites that fire a kick when a todo becomes claimable (`ready`).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOrchestratorKick, fireOrchestratorKick } from '../orchestrator-kick';
import { createTodo, updateTodo, completeTodo, resetTodo, listReadyTodos, _closeProject } from '../todo-store';

describe('orchestrator-kick seam', () => {
  afterEach(() => registerOrchestratorKick(() => {})); // reset hook between tests

  test('fire is a no-op until a hook is registered, then routes to it', () => {
    // No throw when unregistered (importing the store in isolation is side-effect-free).
    registerOrchestratorKick(undefined as unknown as (r: string) => void);
    expect(() => fireOrchestratorKick('before-register')).not.toThrow();

    const reasons: string[] = [];
    registerOrchestratorKick((r) => reasons.push(r));
    fireOrchestratorKick('after-register');
    expect(reasons).toEqual(['after-register']);
  });

  test('a throwing hook never propagates into the caller', () => {
    registerOrchestratorKick(() => { throw new Error('boom'); });
    expect(() => fireOrchestratorKick('x')).not.toThrow();
  });
});

describe('todo-store fires the kick on ready transitions', () => {
  let project: string;
  let kicks: string[];

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'kick-'));
    kicks = [];
    registerOrchestratorKick((r) => kicks.push(r));
  });
  afterEach(() => {
    registerOrchestratorKick(() => {});
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  test('createTodo with status ready kicks; a non-ready create does not', async () => {
    await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'plain' });
    expect(kicks).toEqual([]);

    await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'hot', status: 'ready' });
    expect(kicks.length).toBe(1);
    // De-conflate: status:'ready' is the APPROVE decision → the kick keys on it.
    expect(kicks[0]).toStartWith('todo-created-approved:');
  });

  test('updateTodo kicks only on the transition INTO ready', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'a', status: 'planned' });
    expect(kicks).toEqual([]);

    // planned → ready (approve): kick.
    await updateTodo(project, t.id, { status: 'ready' });
    expect(kicks.length).toBe(1);
    expect(kicks[0]).toStartWith('approved:');

    // ready → ready (idempotent re-write, e.g. a title edit): no new kick.
    await updateTodo(project, t.id, { title: 'a2' });
    expect(kicks.length).toBe(1);

    // ready → in_progress (claim) then a non-ready edit: no kick.
    await updateTodo(project, t.id, { status: 'blocked' });
    expect(kicks.length).toBe(1);
  });

  test('completeTodo fires a dep-terminal kick; the unblocked dependent DERIVES claimable', async () => {
    const dep = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'dep', status: 'ready' });
    // De-conflate: a dep-blocked child is APPROVED + has an unsatisfied dep (derives
    // deps-pending) — NOT status:'blocked' (the seam would make that a manual hold,
    // which the dep completion would NOT clear).
    const child = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'child', status: 'ready', dependsOn: [dep.id] });
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(child.id); // held by the dep
    kicks.length = 0; // ignore the create kicks

    const res = await completeTodo(project, dep.id, 'accepted');
    // The blocked→ready fan-out is DELETED — `promoted` is always empty now; the
    // child simply DERIVES claimable once its dep is terminal.
    expect(res.promoted).toEqual([]);
    expect(listReadyTodos(project).map((t) => t.id)).toContain(child.id);
    // A dep-terminal completion fires the capacity kick so the daemon re-ticks.
    expect(kicks.some((k) => k.startsWith('dep-terminal:'))).toBe(true);
  });

  test('completeTodo fires the dep-terminal capacity kick even when nothing unblocks', async () => {
    const solo = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'solo', status: 'ready' });
    kicks.length = 0;
    const res = await completeTodo(project, solo.id, 'accepted');
    expect(res.promoted).toEqual([]);
    // De-conflate: a non-rejected completion is itself the capacity event → it kicks
    // (dep-terminal) regardless of dependents, so a freed lane re-ticks promptly.
    expect(kicks).toEqual([`dep-terminal:${solo.id.slice(0, 8)}`]);
  });

  test('resetTodo to ready kicks (steward unstick)', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'stuck', status: 'blocked' });
    kicks.length = 0;
    await resetTodo(project, t.id); // defaults to 'ready' = approve + clear-hold
    expect(kicks.length).toBe(1);
    expect(kicks[0]).toStartWith('unheld:');
  });
});
