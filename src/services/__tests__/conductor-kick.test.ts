// Runs via `bun test` (uses bun:sqlite via todo-store) — excluded from vitest (Node).
//
// Covers the event-driven CONDUCTOR kick path: the conductorKickHook seam
// (registerConductorKick/fireConductorKick, mirroring orchestrator-kick.test.ts's
// coverage of the build-tick seam) and the todo-store/mission-store mutation sites
// that fire a conductor kick — the crit_1 regression that a leaf-settle event
// (including a REJECTION) is not swallowed by the 30s conductor heartbeat.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerConductorKick, fireConductorKick } from '../orchestrator-kick';
import { createTodo, claimTodo, completeTodo, holdLeafIfOwned, stampEpicLandedAt, _closeProject } from '../todo-store';

describe('conductor-kick seam', () => {
  afterEach(() => registerConductorKick(() => {})); // reset hook between tests

  test('fire is a no-op until a hook is registered, then routes to it', () => {
    // No throw when unregistered (importing the store in isolation is side-effect-free).
    registerConductorKick(undefined as unknown as (r: string) => void);
    expect(() => fireConductorKick('before-register')).not.toThrow();

    const reasons: string[] = [];
    registerConductorKick((r) => reasons.push(r));
    fireConductorKick('after-register');
    expect(reasons).toEqual(['after-register']);
  });

  test('a throwing hook never propagates into the caller', () => {
    registerConductorKick(() => { throw new Error('boom'); });
    expect(() => fireConductorKick('x')).not.toThrow();
  });
});

describe('todo-store fires the conductor kick on mission-relevant events', () => {
  let project: string;
  let kicks: string[];

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'conductor-kick-'));
    kicks = [];
    registerConductorKick((r) => kicks.push(r));
  });
  afterEach(() => {
    registerConductorKick(() => {});
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  // crit_1: a rejection is precisely the conductor-relevant event the 30s heartbeat
  // delayed reacting to — completeTodo must kick even (especially) on 'rejected',
  // unlike the orchestrator's dep-terminal kick which skips it.
  test('completeTodo(rejected), claim-free, fires leaf-settled', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'x', status: 'ready' });
    kicks.length = 0; // ignore the create kick, if any

    await completeTodo(project, t.id, 'rejected');
    expect(kicks).toContain(`leaf-settled:${t.id.slice(0, 8)}`);
  });

  test('completeTodo(accepted) also fires leaf-settled', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'x', status: 'ready' });
    kicks.length = 0;

    await completeTodo(project, t.id, 'accepted');
    expect(kicks).toContain(`leaf-settled:${t.id.slice(0, 8)}`);
  });

  test('holdLeafIfOwned fires leaf-parked on a successful hold', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'agent-1', 60000); // → in_progress
    kicks.length = 0;

    expect(await holdLeafIfOwned(project, t.id, 'test hold')).toBe(true);
    expect(kicks).toContain(`leaf-parked:${t.id.slice(0, 8)}`);
  });

  test('holdLeafIfOwned does NOT fire when the hold is rejected (not owned)', async () => {
    const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'x', status: 'ready' });
    kicks.length = 0;

    expect(await holdLeafIfOwned(project, t.id, 'test hold')).toBe(false); // not in_progress
    expect(kicks).toEqual([]);
  });

  test('stampEpicLandedAt fires epic-landed', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'epic', kind: 'epic', status: 'planned' });
    kicks.length = 0;

    stampEpicLandedAt(project, epic.id, new Date().toISOString());
    expect(kicks).toContain(`epic-landed:${epic.id.slice(0, 8)}`);
  });
});
