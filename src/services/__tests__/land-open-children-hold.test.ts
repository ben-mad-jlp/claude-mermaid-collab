/**
 * D2: land execution holds on an OPEN child at land time (friction c31ef24f).
 *
 * `checkLandDeps` already re-derives an epic's gating children from LIVE store
 * state; these tests pin its behavior for the exact scenarios the fix depends
 * on: a newly-filed sibling holds land, a completed+accepted sibling unblocks
 * it, and dropping one sibling does not unblock while another is still open.
 *
 * The trailing `landEpic` test is a wiring smoke test — it proves the call
 * chain up to the new land-time re-check is intact (epic-children-incomplete
 * from the pre-existing steward-proof path), not a proof of the new check's
 * own logic (the pure `checkLandDeps` unit tests above are that proof).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-open-children-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { checkLandDeps } from '../land-authority';
import type { Todo } from '../todo-store';
import { landEpic } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

let seq = 0;

function todo(partial: Partial<Todo> & { id?: string; title: string; parentId?: string | null }): Todo {
  const { title, id, status: statusOverride, ...rest } = partial;
  const status = statusOverride ?? ('ready' as const);
  return {
    id: id ?? `t${++seq}`,
    title,
    kind: 'leaf',
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    status,
    completed: status === 'done',
    ...rest,
  } as Todo;
}

describe('checkLandDeps — land-time open-children hold (D2 / friction c31ef24f)', () => {
  it('build-green epic → filing a new planned sibling child holds the land', () => {
    const epicId = 'e1';
    const epic = todo({ id: epicId, title: '[EPIC] the work', kind: 'epic' });
    const landLeaf = todo({ id: 'land1', title: '[LAND] merge e1', parentId: epicId, kind: 'land' });
    const buildChild = todo({
      id: 'build1', title: 'leaf: build', parentId: epicId,
      status: 'done', acceptanceStatus: 'accepted',
    });

    const todos = [epic, landLeaf, buildChild];
    expect(checkLandDeps(todos, epicId)).toBeNull();

    // Simulate a sibling dropped-and-replaced (or any newly-filed child) landing
    // in the store AFTER the epic went green.
    const newChild = todo({ id: 'build2', title: 'leaf: replacement build', parentId: epicId, status: 'planned' });
    const withNewChild = [...todos, newChild];

    const blocker = checkLandDeps(withNewChild, epicId);
    expect(blocker).not.toBeNull();
    expect(blocker!.code).toBe('land-deps-unsatisfied');
  });

  it('the new child completing + being accepted clears the hold', () => {
    const epicId = 'e1';
    const epic = todo({ id: epicId, title: '[EPIC] the work', kind: 'epic' });
    const landLeaf = todo({ id: 'land1', title: '[LAND] merge e1', parentId: epicId, kind: 'land' });
    const buildChild = todo({
      id: 'build1', title: 'leaf: build', parentId: epicId,
      status: 'done', acceptanceStatus: 'accepted',
    });
    const newChild = todo({ id: 'build2', title: 'leaf: replacement build', parentId: epicId, status: 'planned' });

    const held = [epic, landLeaf, buildChild, newChild];
    expect(checkLandDeps(held, epicId)).not.toBeNull();

    const completedNewChild = { ...newChild, status: 'done' as const, acceptanceStatus: 'accepted' as const };
    const cleared = [epic, landLeaf, buildChild, completedNewChild];
    expect(checkLandDeps(cleared, epicId)).toBeNull();
  });

  it('dropping one open child does not unblock land while another sibling is still open', () => {
    const epicId = 'e1';
    const epic = todo({ id: epicId, title: '[EPIC] the work', kind: 'epic' });
    const landLeaf = todo({ id: 'land1', title: '[LAND] merge e1', parentId: epicId, kind: 'land' });
    const childA = todo({
      id: 'a', title: 'leaf: A', parentId: epicId,
      status: 'done', acceptanceStatus: 'accepted',
    });
    const childB = todo({ id: 'b', title: 'leaf: B', parentId: epicId, status: 'planned' });

    // Drop child A while child B is still open.
    const droppedA = { ...childA, status: 'dropped' as const };
    const todos = [epic, landLeaf, droppedA, childB];

    const blocker = checkLandDeps(todos, epicId);
    expect(blocker).not.toBeNull();
    expect(blocker!.code).toBe('land-deps-unsatisfied');
  });
});

describe('landEpic — land-time re-check wiring smoke test', () => {
  let repo: string;
  let epicId: string;
  let escalationId: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-open-children-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    const epic = await createTodo(repo, { allowOrphan: true,
      title: '[EPIC] land test',
      ownerSession: 'test',
      kind: 'epic',
    });
    epicId = epic.id;
    const landChild = await createTodo(repo, { allowOrphan: true,
      title: '[LAND] → master',
      ownerSession: 'test',
      parentId: epic.id,
      kind: 'land',
    });
    // One incomplete build child — never done, so validateStewardProof's
    // pre-existing epic-children-incomplete path fires before the new
    // land-time re-check is even reached, proving the call chain up to it
    // is intact.
    await createTodo(repo, { allowOrphan: true,
      title: 'leaf: build',
      ownerSession: 'test',
      parentId: epic.id,
      kind: 'leaf',
    });
    const { escalation } = createEscalation({
      project: repo,
      session: 'sX',
      kind: 'epic-ready-to-land',
      questionText: 'ready to land?',
      todoId: landChild.id,
    });
    escalationId = escalation.id;
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('refuses to land with an incomplete build child (call chain reaches the new check intact)', async () => {
    const out = await landEpic(repo, escalationId);
    expect(out.ok).toBe(false);
    expect(out.landed).toBe(false);
  });
});
