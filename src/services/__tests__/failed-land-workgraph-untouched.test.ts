/**
 * Real-store + real-git falsifier: a failing land must leave the unrun leaf's stored
 * state and claimability exactly as they were, and a genuine success must not be rolled
 * back by the same guard.
 *
 * Merges the real-git repo + WorktreeManager pattern from post-land-index-residue.test.ts
 * with the real-store/escalation fixture pattern from land-workgraph-guard.test.ts. No
 * mocks of the code under test — `restoreWorkGraphSnapshot`/`snapshotEpicWorkGraph`/
 * `diffWorkGraphSnapshot` (land-workgraph-guard.ts) always run for real; only
 * `LandStageDeps` stage functions are ever overridden.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-failed-land-untouched-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic, type LandStageDeps, defaultLandStageDeps } from '../coordinator-land';
import { createTodo, updateTodo, getTodo, listTodos, _closeProject, type Todo } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { isClaimable } from '../claimability';
import { WorktreeManager } from '../../agent/worktree-manager';

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

afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

interface Fixture {
  repo: string;
  persistDir: string;
  mgr: WorktreeManager;
  epicId: string;
  landLeafId: string;
  leafId: string;
  escalationId: string;
}

/**
 * Builds a real git repo + real work-graph (epic → land leaf + unrun leaf), materializes
 * the epic's branch/worktree via WorktreeManager.ensureEpic with a real commit so
 * deriveEpicLandProof sees a non-empty diff, then approves both rows so the leaf is
 * claimable pre-land.
 */
async function buildFixture(tag: string): Promise<Fixture> {
  const repo = mkdtempSync(join(tmpdir(), `failed-land-repo-${tag}-`));
  await runGit(repo, ['init', '-q', '-b', 'master']);
  await runGit(repo, ['config', 'user.email', 't@t']);
  await runGit(repo, ['config', 'user.name', 'T']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  // .collab/ (the todo-store/epic-land-record db dir) is created inside repo and must be
  // excluded from git status, else the real dirty-tree check trips on it.
  writeFileSync(join(repo, '.gitignore'), '.collab/\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'base']);

  const epic = await createTodo(repo, {
    allowOrphan: true,
    title: `[EPIC] failed-land-untouched ${tag}`,
    ownerSession: 'test',
    kind: 'epic',
  });
  const landLeaf = await createTodo(repo, {
    allowOrphan: true,
    title: '[LAND] → master',
    ownerSession: 'test',
    parentId: epic.id,
    kind: 'land',
  });
  const leaf = await createTodo(repo, {
    allowOrphan: true,
    title: 'unrun leaf',
    ownerSession: 'test',
    parentId: epic.id,
    kind: 'leaf',
    status: 'todo',
  });

  const persistDir = mkdtempSync(join(tmpdir(), `failed-land-persist-${tag}-`));
  const mgr = new WorktreeManager({
    projectRoot: repo,
    baseDir: join(persistDir, 'worktrees'),
    persistDir,
  });

  const epicWorktree = await mgr.ensureEpic(epic.id, undefined, 'master');
  if (!epicWorktree) throw new Error('ensureEpic returned null');
  writeFileSync(join(epicWorktree.path, 'epic-work.txt'), 'epic work\n');
  await runGit(epicWorktree.path, ['add', '-A']);
  await runGit(epicWorktree.path, ['commit', '-q', '-m', 'epic: real work']);

  // Approve both rows so the leaf is claimable pre-land (translateStatusWrite keeps a
  // 'todo'-status row's stored status unchanged while stamping approvedAt).
  await updateTodo(repo, epic.id, { status: 'ready' });
  await updateTodo(repo, leaf.id, { status: 'ready' });

  const { escalation } = createEscalation({
    audience: 'internal',
    project: repo,
    session: 'test-session',
    kind: 'epic-ready-to-land',
    questionText: 'ready to land?',
    todoId: landLeaf.id,
  });

  return {
    repo,
    persistDir,
    mgr,
    epicId: epic.id,
    landLeafId: landLeaf.id,
    leafId: leaf.id,
    escalationId: escalation.id,
  };
}

function byId(repo: string): Map<string, Todo> {
  return new Map(listTodos(repo, { includeCompleted: true }).map((t) => [t.id, t]));
}

function teardown(fx: Fixture): void {
  _closeProject(fx.repo);
  try { rmSync(fx.repo, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(fx.persistDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('failed land keeps the unrun leaf stored state and claimability untouched', () => {
  describe('Arm A — real dirty-tree refusal', () => {
    let fx: Fixture;

    beforeEach(async () => {
      fx = await buildFixture('arm-a');
    });

    afterEach(() => teardown(fx));

    it('Arm A — a real dirty-tree refusal leaves the unrun leaf\'s stored state and claimability untouched', async () => {
      // Real uncommitted mutation in the MAIN checkout (not the epic worktree), left
      // unstaged, so wm.dirtyPaths() is non-empty and the real checkDirtyTree refuses.
      writeFileSync(join(fx.repo, 'base.txt'), 'base edited by a stray process\n');

      const priorLeaf = getTodo(fx.repo, fx.leafId)!;

      const outcome = await landEpic(fx.repo, fx.escalationId);

      expect(outcome.landed).not.toBe(true);
      expect(outcome.reason).toBe('dirty-tree');

      const afterLeaf = getTodo(fx.repo, fx.leafId)!;
      expect(afterLeaf.status).toBe(priorLeaf.status);
      expect(afterLeaf.acceptanceStatus).toBe(priorLeaf.acceptanceStatus);
      expect(afterLeaf.claim).toBe(priorLeaf.claim);
      expect(afterLeaf.claimedBy).toBe(priorLeaf.claimedBy);
      expect(afterLeaf.heldAt).toBe(priorLeaf.heldAt);

      expect(isClaimable(afterLeaf, byId(fx.repo))).toBe(true);
    });
  });

  describe('Arm B — mutation/falsifier arm', () => {
    let fx: Fixture;

    beforeEach(async () => {
      fx = await buildFixture('arm-b');
    });

    afterEach(() => teardown(fx));

    // Falsifier for restoreWorkGraphSnapshot (src/services/land-workgraph-guard.ts:162):
    // runMerge here performs a REAL drop of the unrun leaf before refusing with
    // 'epic-merge-conflict'. This arm is RED if restoreWorkGraphSnapshot is removed, or
    // if restoreOnFailure (coordinator-land.ts:1208-1242) stops calling it — because then
    // the drop from this arm's own runMerge stub survives and status stays 'dropped'.
    it('Arm B — a runMerge-driven drop of the unrun leaf is restored on refusal (falsifier for restoreWorkGraphSnapshot)', async () => {
      const priorLeaf = getTodo(fx.repo, fx.leafId)!;

      const overrideDeps: LandStageDeps = {
        ...defaultLandStageDeps,
        runMerge: async (wm, epicId, dirty, opts, proof, ctx) => {
          await updateTodo(fx.repo, fx.leafId, { status: 'dropped' });
          return { ok: false, landed: false, reason: 'epic-merge-conflict', epicId, epicBranch: ctx.epicBranch };
        },
      };

      const outcome = await landEpic(fx.repo, fx.escalationId, {}, overrideDeps);

      expect(outcome.landed).not.toBe(true);

      const afterLeaf = getTodo(fx.repo, fx.leafId)!;
      expect(afterLeaf.status).toBe(priorLeaf.status);

      expect(isClaimable(afterLeaf, byId(fx.repo))).toBe(true);
    });
  });

  describe('Arm C — no over-reach on a genuine success', () => {
    let fx: Fixture;

    beforeEach(async () => {
      fx = await buildFixture('arm-c');
      // Drop the unrun leaf so it is excluded from both checkLandDeps' gating set
      // (land-authority.ts:274, dropped rows are never gating) and the steward
      // re-proof's epicChildIds (epicGatingChildren filters out dropped rows too) — an
      // accepted-but-uncommitted leaf would otherwise trip the G9 unlanded-leaves check.
      // This fixture's job is to actually reach a real merge, not exercise leaf gating.
      await updateTodo(fx.repo, fx.leafId, { status: 'dropped' });
      // The [LAND] leaf stays a gating child of runStewardPrecheck's epicChildIds
      // (epicGatingChildren only excludes dropped rows), so mark it terminal too;
      // isLandTodo exempts it from the separate G9 unlanded-leaves scan.
      await updateTodo(fx.repo, fx.landLeafId, { status: 'done' });
    });

    afterEach(() => teardown(fx));

    it('Arm C — a genuine land success is not rolled back by the failure-restore guard', async () => {
      const priorLeaf = getTodo(fx.repo, fx.leafId)!;

      const outcome = await landEpic(fx.repo, fx.escalationId);

      expect(outcome.landed).toBe(true);
      // landEpic's own success tail writes a real merge commit to master and records
      // it via finalizeLandRecord/recordLandCycle (masterSha survives) — todo.landedAt
      // itself is stamped by a separate downstream reconcile path, not by landEpic,
      // so it is not asserted here (epic-landedness.ts's documented landed/landedAt
      // divergence). What we DO assert is that restoreOnFailure's landed===true
      // short-circuit did not undo this real merge output.
      expect(outcome.masterSha).toBeTruthy();

      const afterLeaf = getTodo(fx.repo, fx.leafId)!;
      expect(afterLeaf.status).toBe(priorLeaf.status);
      expect(afterLeaf.acceptanceStatus).toBe(priorLeaf.acceptanceStatus);
    }, 30000);
  });
});
