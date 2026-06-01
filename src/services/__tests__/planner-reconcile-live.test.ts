import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeReconcileDeps, resolveReconcile, isReconcilePending, reconcileInputExists } from '../planner-reconcile-live';
import { runReconcile, type ReconcileInputs, type PlanNode } from '../planner-reconcile';

const n = (id: string, dependsOn: string[] = []): PlanNode => ({ id, dependsOn, parentId: null });
const projects: string[] = [];
function tmpProject(): string { const p = mkdtempSync(join(tmpdir(), 'reconcile-live-')); projects.push(p); return p; }
afterEach(() => { for (const p of projects.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe('makeReconcileDeps (live spawn adapter)', () => {
  it('writes inputs to a file, spawns, and resolves when the session submits', async () => {
    const project = tmpProject();
    let spawnedId = '';
    let inputsWritten = false;
    const deps = makeReconcileDeps(project, {
      launch: async ({ invokeSkill, session }) => {
        spawnedId = invokeSkill.split(' ')[1];
        expect(session).toBe(`reconcile-${spawnedId.slice(0, 8)}`);
        inputsWritten = reconcileInputExists(project, spawnedId); // file exists before launch returns
        // simulate the spawned session reporting back
        queueMicrotask(() => resolveReconcile(spawnedId, { mergedGraph: [n('x'), n('y')], newConstraints: [{ title: 'k' }] }));
        return { started: true };
      },
    });
    // non-orthogonal so runReconcile delegates to llmMerge
    const inputs: ReconcileInputs = { deltaA: [n('x', ['y'])], deltaB: [n('y')], constraints: [] };
    const r = await runReconcile(deps, inputs);
    expect(inputsWritten).toBe(true);
    expect(r.method).toBe('llm-merge');
    expect(r.valid).toBe(true);
    expect(r.mergedGraph.map((x) => x.id).sort()).toEqual(['x', 'y']);
    expect(r.newConstraints).toEqual([{ title: 'k' }]);
    expect(isReconcilePending(spawnedId)).toBe(false); // consumed
  });

  it('rejects (and clears pending) when the spawn fails to start', async () => {
    const project = tmpProject();
    const deps = makeReconcileDeps(project, { launch: async () => ({ started: false, reason: 'no-tmux' }) });
    await expect(deps.llmMerge({ deltaA: [n('x', ['y'])], deltaB: [n('y')], constraints: [] }))
      .rejects.toThrow('failed to start');
  });

  it('times out if the session never reports', async () => {
    const project = tmpProject();
    const deps = makeReconcileDeps(project, { timeoutMs: 30, launch: async () => ({ started: true }) });
    await expect(deps.llmMerge({ deltaA: [n('x', ['y'])], deltaB: [n('y')], constraints: [] }))
      .rejects.toThrow('reconcile timeout');
  });

  it('orthogonal deltas short-circuit — llmMerge/spawn is never invoked', async () => {
    const project = tmpProject();
    let spawned = false;
    const deps = makeReconcileDeps(project, { launch: async () => { spawned = true; return { started: true }; } });
    const r = await runReconcile(deps, { deltaA: [n('a1')], deltaB: [n('b1')], constraints: [] });
    expect(r.method).toBe('orthogonal-union');
    expect(spawned).toBe(false);
    expect(existsSync(join(project, '.collab', 'reconcile'))).toBe(false); // no inputs file written
  });

  it('resolveReconcile returns false for an unknown/timed-out id', () => {
    expect(resolveReconcile('no-such-id', { mergedGraph: [] })).toBe(false);
  });
});
