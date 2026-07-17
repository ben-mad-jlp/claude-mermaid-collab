import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the global supervisor.db BEFORE importing anything that opens it.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-oi1-landedat-supervisor-'));

import { acceptTimeAncestorGate, getWorktreeManager } from '../coordinator-live';
import { createTodo, completeTodo, getTodo, listTodos } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { upsertMission } from '../mission-store';

/**
 * OI-1 crit-6 divergence: acceptTimeAncestorGate proves epic integration onto the
 * target ref at several CONFIRMED points but never stamped `landedAt`. A leafless
 * mission epic that lands purely through this gate then looks perpetually unlanded
 * to every downstream consumer that reads `landedAt`. This pins the fix: the three
 * confirmed-integration branches (reachable-accept, land-reconcile, reachable-after-land)
 * now stamp `landedAt`, while the fail-safe/indeterminate branches never do.
 */

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code: code ?? 0, stdout };
}

async function setupMissionArmedEpic(repo: string, title: string) {
  const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] oi1 landedat', kind: 'mission', status: 'planned' });
  upsertMission(repo, mission.id); // active (default) + non-terminal → live mission epic
  const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title, kind: 'epic', status: 'planned', parentId: mission.id });
  const leaf = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: 'leaf', parentId: epic.id, status: 'ready' });
  await completeTodo(repo, leaf.id, 'accepted');
  return { epic, leaf };
}

describe('OI-1 — acceptTimeAncestorGate stamps landedAt at every confirmed-integration point', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-oi1-landedat-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    setOrchestratorLevel(repo, 'on');
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
  });

  it('reachable-after-land stamps landedAt, no [LAND] child todo required', async () => {
    const { epic, leaf } = await setupMissionArmedEpic(repo, '[EPIC] oi1 reachable-after-land');

    // Build the epic accumulation branch carrying the leaf's trailer, forked off
    // master — NOT yet merged to master. The initial probe returns false; the
    // gate's own internal landEpicToMaster reconcile then merges it, and the
    // re-probe returns true.
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-oi1-epicwt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', epicBranch, wt, 'master']);
    await fs.writeFile(path.join(wt, 'leaf.txt'), 'L\n');
    await runGit(wt, ['add', '-A']);
    await runGit(wt, ['commit', '-q', '-m', `leaf\n\nCollab-Todo: ${leaf.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', wt]);

    const result = await acceptTimeAncestorGate(repo, leaf.id, epic.id, [], 'leaf', 's');
    expect(result).toBe(true);
    expect(getTodo(repo, epic.id)!.landedAt).toBeTruthy();

    const allTodos = listTodos(repo, { includeCompleted: true });
    const landChildren = allTodos.filter((t) => t.parentId === epic.id && t.kind === 'land');
    expect(landChildren.length).toBe(0);
  });

  it('reachable-accept stamps landedAt when the commit is already on the integration ref', async () => {
    const { epic, leaf } = await setupMissionArmedEpic(repo, '[EPIC] oi1 reachable-accept');

    // Land the epic branch straight to master first, so the gate's INITIAL probe
    // already resolves true (the reachable-accept branch, not the reconcile path).
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-oi1-epicwt2-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', epicBranch, wt, 'master']);
    await fs.writeFile(path.join(wt, 'leaf2.txt'), 'L2\n');
    await runGit(wt, ['add', '-A']);
    await runGit(wt, ['commit', '-q', '-m', `leaf\n\nCollab-Todo: ${leaf.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', wt]);
    const land = await getWorktreeManager(repo).landEpicToMaster(epic.id);
    expect(land.landed).toBe(true);

    const result = await acceptTimeAncestorGate(repo, leaf.id, epic.id, [], 'leaf', 's');
    expect(result).toBe(true);
    expect(getTodo(repo, epic.id)!.landedAt).toBeTruthy();
  });

  it('skip-non-git fail-safe path does NOT stamp landedAt', async () => {
    const nonGitProject = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-oi1-nongit-'));
    setOrchestratorLevel(nonGitProject, 'on');
    const { epic, leaf } = await setupMissionArmedEpic(nonGitProject, '[EPIC] oi1 non-git');

    const result = await acceptTimeAncestorGate(nonGitProject, leaf.id, epic.id, [], 'leaf', 's');
    expect(result).toBe(true); // fail-safe: accept
    expect(getTodo(nonGitProject, epic.id)!.landedAt).toBeFalsy();

    await fs.rm(nonGitProject, { recursive: true, force: true }).catch(() => {});
  });
});
