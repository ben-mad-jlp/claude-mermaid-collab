import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the global supervisor.db BEFORE importing anything that opens it
// (the BP1 filter records a supervisor-audit row when it blocks a dependent).
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-bp1-supervisor-'));

import { bp1FilterStrandedFoundations, getWorktreeManager, classifyClaimSuppression } from '../coordinator-live';
import { createTodo, completeTodo, getTodo } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { upsertMission } from '../mission-store';

/**
 * BP1 — a ready dependent must NOT be claimed while its foundation is
 * accepted-but-stranded (the dep is done+accepted but its commit isn't reachable
 * from integration). bp1FilterStrandedFoundations is the pure claim-time filter
 * that drops such dependents; once the foundation lands, they flow again.
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

describe('BP1 — block a dependent whose foundation is accepted-but-stranded', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp1-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
  });

  it('UNION SURFACE: at auto, a same-epic foundation on the epic branch (not yet landed) is ADMITTED — the lane forks from the epic-branch tip, so it is visible', async () => {
    // The human-LAND-epic case (yolox FW): at `auto` an epic with a HUMAN [LAND] leaf
    // does NOT auto-land per-leaf — its accepted foundations accumulate on the epic
    // branch and reach master only at the human LAND. bp1's claim-time reachability must
    // test the DEPENDENT's epic-branch tip (the base its lane forks from), NOT trunk only.
    // (Trunk-only wrongly stranded EVERY in-epic sibling until the human landed — the bug.)
    setOrchestratorLevel(repo, 'on');
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] bp1 test', kind: 'epic', status: 'planned' });
    const foundation = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: 'foundation leaf', parentId: epic.id, status: 'planned' });
    const dependent = await createTodo(repo, { allowOrphan: true,
      ownerSession: 's', title: 'dependent leaf', parentId: epic.id, status: 'ready',
      dependsOn: [foundation.id],
    });
    await completeTodo(repo, foundation.id, 'accepted');

    // Build the epic branch carrying the foundation's trailer — on the epic branch, NOT
    // merged to master. Throwaway worktree so the main tree (.collab/todos.db) is never
    // checked out.
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp1-epicwt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', epicBranch, wt, 'master']);
    await fs.writeFile(path.join(wt, 'foundation.txt'), 'F\n');
    await runGit(wt, ['add', '-A']);
    await runGit(wt, ['commit', '-q', '-m', `foundation leaf\n\nCollab-Todo: ${foundation.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', wt]);

    const dep = getTodo(repo, dependent.id)!;

    // On the epic branch (not trunk) at auto → ADMITTED via arm B (epic-branch tip).
    const admittedPreLand = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(admittedPreLand.map((t) => t.id)).toContain(dependent.id);

    // Still admitted after the epic lands to master (arm A now also true).
    const land = await getWorktreeManager(repo).landEpicToMaster(epic.id);
    expect(land.landed).toBe(true);
    const admittedPostLand = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(admittedPostLand.map((t) => t.id)).toContain(dependent.id);
  });

  it('NON-MISSION epic KEEPS its stranded foundation regardless of level (A1 per-epic-authority pin)', async () => {
    // Under A1 per-epic-authority: a non-mission epic has NO authority (epicAutoLandAuthority === false),
    // so bp1FilterStrandedFoundations early-returns and KEEPS the dependent even though the
    // foundation is genuinely stranded. This pins the A1 early-return at coordinator-live.ts:912.
    setOrchestratorLevel(repo, 'on'); // level is now irrelevant — no mission → no authority
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] bp1 non-mission strand', kind: 'epic', status: 'planned' });
    const foundation = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: 'phantom foundation', parentId: epic.id, status: 'planned' });
    const dependent = await createTodo(repo, { allowOrphan: true,
      ownerSession: 's', title: 'dependent', parentId: epic.id, status: 'ready', dependsOn: [foundation.id],
    });
    await completeTodo(repo, foundation.id, 'accepted');

    // Epic branch EXISTS but does NOT contain the foundation commit (forked off master, empty).
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    await runGit(repo, ['branch', epicBranch, 'master']);
    // The foundation's commit lives on an unrelated lane branch — reachable from neither
    // the epic branch nor master.
    const laneWt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp1-nm-lanewt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', `collab/leaf-exec-${foundation.id.slice(0, 8)}`, laneWt, 'master']);
    await fs.writeFile(path.join(laneWt, 'phantom.txt'), 'P\n');
    await runGit(laneWt, ['add', '-A']);
    await runGit(laneWt, ['commit', '-q', '-m', `phantom foundation\n\nCollab-Todo: ${foundation.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', laneWt]);

    const dep = getTodo(repo, dependent.id)!;
    const out = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(out.map((t) => t.id)).toContain(dependent.id); // non-mission epic → authority FALSE → early-return keeps it
  });

  it('TRUE STRAND (mission-armed epic): a foundation reachable from NEITHER the epic branch NOR trunk is DROPPED', async () => {
    // The genuine phantom-base case the filter exists for: the foundation's commit landed
    // out-of-band (e.g. on a lane branch) carrying its trailer, but never reached the epic
    // accumulation branch OR master. The dependent's lane (forked from the epic-branch tip)
    // would NOT contain it → building on it is unsafe → drop it this tick.
    // Re-cast under A1 per-epic-authority: the epic is MISSION-ARMED so
    // epicAutoLandAuthority returns TRUE and the drop path fires.
    setOrchestratorLevel(repo, 'on');
    const mission = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[MISSION] converge', kind: 'mission', status: 'planned' });
    upsertMission(repo, mission.id); // active (default) + non-terminal → live mission epic
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] bp1 true-strand', kind: 'epic', status: 'planned', parentId: mission.id });
    const foundation = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: 'phantom foundation', parentId: epic.id, status: 'planned' });
    const dependent = await createTodo(repo, { allowOrphan: true,
      ownerSession: 's', title: 'dependent', parentId: epic.id, status: 'ready', dependsOn: [foundation.id],
    });
    await completeTodo(repo, foundation.id, 'accepted');

    // Epic branch EXISTS but does NOT contain the foundation commit (forked off master, empty).
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    await runGit(repo, ['branch', epicBranch, 'master']);
    // The foundation's commit lives on an unrelated lane branch — reachable from neither
    // the epic branch nor master.
    const laneWt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp1-lanewt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', `collab/leaf-exec-${foundation.id.slice(0, 8)}`, laneWt, 'master']);
    await fs.writeFile(path.join(laneWt, 'phantom.txt'), 'P\n');
    await runGit(laneWt, ['add', '-A']);
    await runGit(laneWt, ['commit', '-q', '-m', `phantom foundation\n\nCollab-Todo: ${foundation.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', laneWt]);

    const dep = getTodo(repo, dependent.id)!;
    const out = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(out.map((t) => t.id)).not.toContain(dependent.id); // mission-armed → authority TRUE → dropped
  });

  it('BELOW DRIVE (build): does NOT block — a stranded-vs-integration foundation is the NORMAL on-epic-branch state', async () => {
    // The build123d build_assembly_plan stall: at `build` there is no auto-land, so a
    // done+accepted foundation's commit lives on the epic branch, not integration.
    // BP1 must NOT flag that as stranded (else the whole wave blocks forever).
    setOrchestratorLevel(repo, 'on');
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] bp1 build-level', kind: 'epic', status: 'planned' });
    const foundation = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: 'foundation', parentId: epic.id, status: 'planned' });
    const dependent = await createTodo(repo, { allowOrphan: true,
      ownerSession: 's', title: 'dependent', parentId: epic.id, status: 'ready', dependsOn: [foundation.id],
    });
    await completeTodo(repo, foundation.id, 'accepted'); // done; commit on epic branch only

    const dep = getTodo(repo, dependent.id)!;
    const out = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(out.map((t) => t.id)).toContain(dependent.id); // admitted below drive
    setOrchestratorLevel(repo, 'on'); // restore for the failsafe case below
  });

  it('FAIL-SAFE: a dependent whose done dep carries no commit is admitted (indeterminate)', async () => {
    const epic = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: '[EPIC] bp1 failsafe', kind: 'epic', status: 'planned' });
    const dep0 = await createTodo(repo, { allowOrphan: true, ownerSession: 's', title: 'trailerless dep', parentId: epic.id, status: 'planned' });
    const dependent = await createTodo(repo, { allowOrphan: true,
      ownerSession: 's', title: 'dependent', parentId: epic.id, status: 'ready', dependsOn: [dep0.id],
    });
    await completeTodo(repo, dep0.id, 'accepted'); // done, but NO commit carries its trailer

    const dep = getTodo(repo, dependent.id)!;
    const out = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(out.map((t) => t.id)).toContain(dependent.id); // null probe → satisfied
  });
});

describe('classifyClaimSuppression (transparency — attribute each held leaf to the first filter that dropped it)', () => {
  const leaf = (id: string, over: Partial<{ title: string; claimProbe: string | null; notHeadlessReason: string | null }> = {}) =>
    ({ id, title: over.title ?? id, claimProbe: over.claimProbe ?? null, notHeadlessReason: over.notHeadlessReason ?? null });

  it('a leaf surviving all three filters is claimable (not reported)', () => {
    const ready = [leaf('a')];
    const r = classifyClaimSuppression(ready, new Set(['a']), new Set(['a']), new Set(['a']));
    expect(r).toEqual([]);
  });

  it('probe-down: dropped at the probe filter', () => {
    const ready = [leaf('a', { claimProbe: 'tcp://127.0.0.1:8082' })];
    const r = classifyClaimSuppression(ready, new Set(), new Set(), new Set());
    expect(r).toEqual([{ todoId: 'a', title: 'a', reason: 'probe-down: tcp://127.0.0.1:8082' }]);
  });

  it('stranded-foundation: passed probe, dropped at bp1', () => {
    const ready = [leaf('a')];
    const r = classifyClaimSuppression(ready, new Set(['a']), new Set(), new Set());
    expect(r[0].reason).toMatch(/stranded-foundation/);
  });

  it('not-headless: passed probe + bp1, dropped at headless with its exclusion reason', () => {
    const ready = [leaf('a', { notHeadlessReason: 'epic-or-gate' })];
    const r = classifyClaimSuppression(ready, new Set(['a']), new Set(['a']), new Set());
    expect(r[0].reason).toBe('not-headless: epic-or-gate');
  });

  it('attributes to the FIRST filter only (probe wins over later drops)', () => {
    const ready = [leaf('a', { claimProbe: 'x:1' })];
    // dropped by all three, but probe is first → single probe-down reason
    const r = classifyClaimSuppression(ready, new Set(), new Set(), new Set());
    expect(r).toHaveLength(1);
    expect(r[0].reason).toMatch(/^probe-down/);
  });

  it('mixed set: reports only the suppressed, each with its own reason', () => {
    const ready = [leaf('ok'), leaf('p', { claimProbe: 'h:1' }), leaf('s'), leaf('h', { notHeadlessReason: 'human' })];
    const r = classifyClaimSuppression(ready, new Set(['ok', 's', 'h']), new Set(['ok', 'h']), new Set(['ok']));
    expect(r.map((x) => [x.todoId, x.reason.split(':')[0].split(' ')[0]])).toEqual([
      ['p', 'probe-down'],
      ['s', 'stranded-foundation'],
      ['h', 'not-headless'],
    ]);
  });
});
