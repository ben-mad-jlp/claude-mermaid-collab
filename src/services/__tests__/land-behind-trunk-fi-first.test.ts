/**
 * Behind-trunk ⇒ FI-first (repair-forge incident, 2026-08-14).
 *
 * Two branches can each be green while their MERGE is red — a semantic conflict needs
 * NO overlapping paths. The overlap-based stale-build-base check therefore lets an epic
 * that is behind trunk with zero file overlap land an UNMEASURED merge. The land path's
 * staleness stage must refuse (`behind-trunk-fi-first`) whenever the epic branch is
 * behind trunk by ANY commits, forward-integrate trunk into the epic branch (--no-ff,
 * never rebase) via the existing revalidate machinery, and continue the land in the
 * same job against the new tip — so the gate measures the post-FI tree, which IS the
 * merge result. A conflicted FI aborts untouched, raises the human-rebase escalation,
 * and leaves trunk unmoved.
 *
 * Drives the REAL checkStaleness stage against a REAL temp git repo + WorktreeManager
 * (real forwardIntegrateEpic --no-ff merges), stubbing only the gate runner.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(path.join(os.tmpdir(), 'behind-trunk-fi-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager.ts';
import { checkStaleness, revalidateStaleEpic, type RevalidateDeps } from '../coordinator-land';
import { listOpenEscalations, _closeDb as _closeSupervisorDb } from '../supervisor-store';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

const EPIC_FULL_ID = 'epic-cccccccc-1234-1234-1234-123456789012';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

describe('land staleness stage — behind-trunk ⇒ FI-first', () => {
  let repo: string;
  let persistDir: string;
  let wm: WorktreeManager;
  let ctx: { project: string; session: string; escalationId: string | null; todoId: string };

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'behind-trunk-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'behind-trunk-persist-'));
    wm = new WorktreeManager({
      projectRoot: repo,
      baseDir: path.join(persistDir, 'worktrees'),
      persistDir,
    });
    ctx = { project: repo, session: 'test-session', escalationId: null, todoId: 'todo-1' };
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  async function commitOnMaster(file: string, content: string) {
    await fs.writeFile(path.join(repo, file), content);
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', `master: add ${file}`]);
  }

  async function commitOnEpic(epicPath: string, file: string, content: string) {
    await fs.mkdir(path.dirname(path.join(epicPath, file)), { recursive: true });
    await fs.writeFile(path.join(epicPath, file), content);
    await runGit(epicPath, ['add', '-A']);
    await runGit(epicPath, ['commit', '-q', '-m', `epic: add ${file}`]);
  }

  /** Real revalidate machinery (real forwardIntegrateEpic --no-ff merge in the temp
   *  repo), stubbing only the gate runner — records where/at what sha the gate ran. */
  function realRevalidate(record: { gateRuns: Array<{ cwd?: string; sha: string }> }) {
    return (p: string, e: string) =>
      revalidateStaleEpic(p, e, 'master', {
        forwardIntegrate: (epicId, baseRef) => wm.forwardIntegrateEpic(epicId, baseRef),
        ensureEpicPath: async (epicId) => (await wm.ensureEpic(epicId).catch(() => null))?.path ?? null,
        runGate: async (s) => {
          const sha = (await runGit(s.laneCwd ?? repo, ['rev-parse', 'HEAD'])).stdout.trim();
          record.gateRuns.push({ cwd: s.laneCwd, sha });
          return { passed: true, reasons: [] } as any;
        },
        manifest: { gateCommand: 'noop' } as any,
        getEpicTodo: () => null,
        exec: async () => ({ code: 0, stdout: '', stderr: '' }),
      } satisfies Partial<RevalidateDeps>);
  }

  it('epic behind trunk with ZERO overlapping files → auto-FI runs and the gate measures the post-FI tree', async () => {
    const epic = await wm.ensureEpic(EPIC_FULL_ID, undefined, 'master');
    expect(epic).not.toBeNull();
    const epicBranch = wm.epicBranchName(EPIC_FULL_ID);

    // Divergence with ZERO file overlap: epic touches epic.txt, trunk touches trunk.txt.
    await commitOnEpic(epic!.path, 'epic.txt', 'epic-content\n');
    const epicTipBefore = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();
    await commitOnMaster('trunk.txt', 'trunk-content\n');
    const trunkSha = (await runGit(repo, ['rev-parse', 'master'])).stdout.trim();

    // Pin the GAP: the overlap-based staleness detector does NOT flag this epic
    // (behind trunk, no overlap, within maxAhead) — the old land path sailed through.
    const staleness = await wm.epicBuildBaseStaleness(EPIC_FULL_ID);
    expect(staleness.stale).toBe(false);
    expect(staleness.commitsAhead).toBe(1);
    expect(staleness.overlap).toEqual([]);

    const record = { gateRuns: [] as Array<{ cwd?: string; sha: string }> };
    const result = await checkStaleness(wm as any, repo, EPIC_FULL_ID, epicBranch, ctx, {
      revalidate: realRevalidate(record),
    });

    // Land CONTINUES in the same job (ok:true) — no refusal surfaced on a clean FI.
    expect(result.ok).toBe(true);

    // Auto-FI actually ran: the epic tip moved to a --no-ff merge that carries trunk.
    const epicTipAfter = (await runGit(repo, ['rev-parse', epicBranch])).stdout.trim();
    expect(epicTipAfter).not.toBe(epicTipBefore);
    const trunkReachable = await runGit(repo, ['merge-base', '--is-ancestor', trunkSha, epicBranch]);
    expect(trunkReachable.code).toBe(0);
    const epicWorkReachable = await runGit(repo, ['merge-base', '--is-ancestor', epicTipBefore, epicBranch]);
    expect(epicWorkReachable.code).toBe(0); // merge, never rebase — epic commits survive

    // The gate ran IN the epic worktree AT the post-FI tip — it measured the tree that
    // IS the merge result, not either green branch alone.
    expect(record.gateRuns.length).toBe(1);
    expect(record.gateRuns[0]!.cwd).toBe(epic!.path);
    expect(record.gateRuns[0]!.sha).toBe(epicTipAfter);
  });

  it('epic already at trunk → behavior unchanged: no FI, no extra commit, no escalation', async () => {
    const epic = await wm.ensureEpic(EPIC_FULL_ID, undefined, 'master');
    expect(epic).not.toBeNull();
    const epicBranch = wm.epicBranchName(EPIC_FULL_ID);

    // Epic is AHEAD of trunk only — zero commits behind.
    await commitOnEpic(epic!.path, 'epic.txt', 'epic-content\n');
    const epicTipBefore = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();

    let revalidateCalled = false;
    const result = await checkStaleness(wm as any, repo, EPIC_FULL_ID, epicBranch, ctx, {
      revalidate: async () => {
        revalidateCalled = true;
        return { ok: true };
      },
    });

    expect(result.ok).toBe(true);
    expect(revalidateCalled).toBe(false); // no FI machinery invoked at all
    const epicTipAfter = (await runGit(repo, ['rev-parse', epicBranch])).stdout.trim();
    expect(epicTipAfter).toBe(epicTipBefore); // no extra FI commit
    expect(listOpenEscalations({ project: repo, kind: 'assumption-invalidated' })).toEqual([]);
  });

  it('conflicted auto-FI → land aborts with behind-trunk-fi-first, escalation raised, trunk and epic unmoved', async () => {
    const epic = await wm.ensureEpic(EPIC_FULL_ID, undefined, 'master');
    expect(epic).not.toBeNull();
    const epicBranch = wm.epicBranchName(EPIC_FULL_ID);

    // A REAL zero-name-overlap merge conflict: trunk adds a FILE named `d`; the epic
    // adds `d/x` (directory). Name-only diffs share no path, yet the merge conflicts —
    // exactly the class of conflict the overlap tripwire is blind to.
    await commitOnEpic(epic!.path, 'd/x', 'epic-side\n');
    const epicTipBefore = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();
    await commitOnMaster('d', 'trunk-file\n');
    const trunkShaBefore = (await runGit(repo, ['rev-parse', 'master'])).stdout.trim();

    const staleness = await wm.epicBuildBaseStaleness(EPIC_FULL_ID);
    expect(staleness.stale).toBe(false); // overlap detector blind — the gap this fix closes
    expect(staleness.commitsAhead).toBe(1);

    const record = { gateRuns: [] as Array<{ cwd?: string; sha: string }> };
    const result = await checkStaleness(wm as any, repo, EPIC_FULL_ID, epicBranch, ctx, {
      revalidate: realRevalidate(record),
    });

    // Refused with the NEW reason; nothing landed.
    expect(result.ok).toBe(false);
    expect((result as any).landed).toBe(false);
    expect((result as any).reason).toBe('behind-trunk-fi-first');
    expect(record.gateRuns.length).toBe(0); // gate never ran on a conflicted FI

    // FI aborted untouched: epic tip and trunk both exactly where they were.
    expect((await runGit(repo, ['rev-parse', epicBranch])).stdout.trim()).toBe(epicTipBefore);
    expect((await runGit(repo, ['rev-parse', 'master'])).stdout.trim()).toBe(trunkShaBefore);
    expect((await runGit(epic!.path, ['status', '--porcelain'])).stdout.trim()).toBe('');

    // The existing human-rebase escalation path was raised.
    const cards = listOpenEscalations({ project: repo, kind: 'assumption-invalidated' });
    expect(cards.length).toBe(1);
    expect(cards[0]!.questionText).toContain('behind trunk');
    expect(cards[0]!.questionText).toContain('Master is UNTOUCHED');
  });
});
