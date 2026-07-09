// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, getTodo, splitLeafInto, collapseSplit, completeTodo, sweepEpicRollups, _closeProject,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { isClaimable, claimReason } from '../claimability';
import type { Todo } from '../todo-store';

let project: string;

function derivedClaimable(t: Todo): boolean {
  return isClaimable(t, new Map([[t.id, t]]));
}
function derivedReason(t: Todo): string {
  return claimReason(t, new Map([[t.id, t]]));
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'collapse-split-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});
afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('collapseSplit (SR-2 — decline a split)', () => {
  test('decline-a-split restores the leaf: same id, blueprint preserved, children dropped, claimable again', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'big leaf', status: 'ready',
      parentId: epic.id, description: 'the original blueprint spec',
    });
    const { childIds } = await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts', 'b.ts']);
    expect(childIds.length).toBe(2);

    const result = await collapseSplit(project, leaf.id);

    expect(result.leafId).toBe(leaf.id);
    expect(result.droppedChildIds.sort()).toEqual([...childIds].sort());
    expect(result.alreadyCollapsed).toBe(false);

    const restored = getTodo(project, leaf.id)!;
    expect(restored.id).toBe(leaf.id);
    expect(restored.description).toBe('the original blueprint spec');

    for (const cid of childIds) {
      expect(getTodo(project, cid)!.status).toBe('dropped');
    }

    expect(derivedClaimable(restored)).toBe(true);
    expect(derivedReason(restored)).toBe('claimable');
  });

  test('idempotent: a second collapseSplit is a no-op that reports alreadyCollapsed', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] E' });
    const leaf = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'big leaf', status: 'ready', parentId: epic.id,
    });
    await splitLeafInto(project, getTodo(project, leaf.id)!, ['a.ts']);
    await collapseSplit(project, leaf.id);

    const second = await collapseSplit(project, leaf.id);
    expect(second.droppedChildIds).toEqual([]);
    expect(second.alreadyCollapsed).toBe(true);

    const restored = getTodo(project, leaf.id)!;
    expect(derivedClaimable(restored)).toBe(true);
  });

  test('refuses an [EPIC] container', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] E' });
    await expect(collapseSplit(project, epic.id)).rejects.toThrow();
  });

  test('rollup not broken by the terminal-children status filter', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] rollup', status: 'planned' });
    const c1 = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'c1', status: 'ready', parentId: epic.id });
    const c2 = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'c2', status: 'ready', parentId: epic.id });

    await completeTodo(project, c1.id, 'accepted');
    await completeTodo(project, c2.id, 'accepted');

    expect(getTodo(project, epic.id)!.status).toBe('done');

    // Separate graph, settled out-of-band, still rolls up via the sweep path.
    const epic2 = await createTodo(project, { allowOrphan: true, ownerSession: 's1', kind: 'epic', title: '[EPIC] rollup2', status: 'planned' });
    const d1 = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'd1', status: 'ready', parentId: epic2.id });
    // Directly mark done+accepted, bypassing completeTodo's own rollup, so sweepEpicRollups
    // is the one that has to close the epic.
    const { updateTodo } = await import('../todo-store');
    await updateTodo(project, d1.id, { status: 'done', acceptanceStatus: 'accepted', completed: true });

    const { rolledUp } = await sweepEpicRollups(project);
    expect(rolledUp).toContain(epic2.id);
  });
});
