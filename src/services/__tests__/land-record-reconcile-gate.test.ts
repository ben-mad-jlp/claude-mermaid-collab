/**
 * Mutation-provable coverage for the reconcile-path gate in coordinator-live.ts:
 * `if ((land.baseRef ?? intRef) === intRef)`. Only when a landEpicToMaster result's realised
 * baseRef matches the resolved integration ref does the reconcile path record an
 * `epic_land_record` row — a leaf→integration reconcile (a different baseRef) must NOT be
 * recorded, because that table authorizes worktree reclamation (leaf-worktree-reaper.ts:571)
 * and is the proof an EPIC reached trunk.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (stores open supervisor.db).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-reconcile-gate-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager, type LandResult } from '../../agent/worktree-manager';
import { captureLandCycleFields, recordLandCycle, getEpicLandRecord } from '../epic-land-record-store';
import type { Todo } from '../todo-store';

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
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

// MIRROR of the reconcile record step in src/services/coordinator-live.ts:868-885 — the block
// beginning `if ((land.baseRef ?? intRef) === intRef)` through its `recordLandCycle` call. This
// mirror stays in lockstep because the source-reading case below (lines 182–203) reads
// ../coordinator-live.ts and fails when the gate, its guarded recordLandCycle call, or their
// single-occurrence property changes.
async function reconcileRecordStep(opts: {
  mgr: WorktreeManager;
  project: string;
  epicId: string;
  land: LandResult;
  intRef: string;
  todos: Todo[];
  repoRoot: string;
  session: string;
}): Promise<void> {
  const { mgr, project, epicId, land, intRef, todos, repoRoot, session } = opts;
  if ((land.baseRef ?? intRef) === intRef) {
    const cycle = await captureLandCycleFields({
      epicId,
      todos,
      repoRoot,
      epicHeadSha: () => mgr.epicHeadSha(epicId).catch(() => null),
    });
    await recordLandCycle(project, {
      epicId,
      epicTipSha: cycle.epicTipSha,
      landedMergeSha: land.masterSha ?? '',
      source: 'reconcile-land',
      session,
      nonTerminalServingLeafIds: cycle.nonTerminalServingLeafIds,
      postLandClean: cycle.postLandClean,
      landPath: 'oi1-reconcile',
    });
  }
}

describe('reconcile-path land-record gate — (land.baseRef ?? intRef) === intRef', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-reconcile-gate-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, '.gitignore'), '.collab/\n');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = mkdtempSync(join(tmpdir(), 'land-reconcile-gate-persist-'));
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(persistDir, 'worktrees'),
      persistDir,
      onMainCheckoutViolation: () => { /* spy only */ },
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(persistDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function buildEpic(epicId: string): Promise<void> {
    const epic = await mgr.ensureEpic(epicId, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'work.txt'), 'epic work\n');
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: work']);
  }

  it('gate TRUE — realised baseRef matches intRef, records with landPath oi1-reconcile', async () => {
    const epicId = 'epic-gate-true';
    await buildEpic(epicId);

    const intRef = await mgr.resolveIntegrationRef();
    expect(intRef).toBeTruthy();

    const land = await mgr.landEpicToMaster(epicId, { baseRef: intRef! });
    expect(land.landed).toBe(true);

    await reconcileRecordStep({
      mgr,
      project: repo,
      epicId,
      land,
      intRef: intRef!,
      todos: [],
      repoRoot: repo,
      session: 'test-session',
    });

    const record = getEpicLandRecord(repo, epicId);
    expect(record).not.toBeNull();
    expect(record!.landPath).toBe('oi1-reconcile');
  });

  it('gate FALSE — realised baseRef diverges from intRef, no record is written', async () => {
    const epicId = 'epic-gate-false';
    await buildEpic(epicId);

    // A second branch so the fixture has a plausible divergent ref target.
    await runGit(repo, ['branch', 'side', 'master']);

    const intRef = await mgr.resolveIntegrationRef();
    expect(intRef).toBeTruthy();

    const land = await mgr.landEpicToMaster(epicId, { baseRef: intRef! });
    expect(land.landed).toBe(true);

    // Model a reconcile whose REALISED baseRef diverges from intRef (a leaf→integration
    // reconcile shape) by overriding the land object's baseRef before the gate check.
    const divergedLand: LandResult = { ...land, baseRef: 'refs/heads/side' };

    await reconcileRecordStep({
      mgr,
      project: repo,
      epicId,
      land: divergedLand,
      intRef: intRef!,
      todos: [],
      repoRoot: repo,
      session: 'test-session',
    });

    // MUTATION PROBE: deleting or inverting the `if ((land.baseRef ?? intRef) === intRef)`
    // gate inside reconcileRecordStep would call recordLandCycle unconditionally, and this
    // toBeNull() assertion would flip to red because the record would be written.
    expect(getEpicLandRecord(repo, epicId)).toBeNull();
  });

  it('production gate is present — coordinator-live.ts gates the reconcile record step', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../coordinator-live.ts', import.meta.url).pathname, 'utf-8');

    const gateExpr = '(land.baseRef ?? intRef) === intRef';
    const recordCall = 'recordLandCycle(';
    const landPath = "landPath: 'oi1-reconcile'";

    // (a) Gate present
    expect(src).toContain(gateExpr);

    // (b) Gate guards the record
    const i = src.indexOf(gateExpr);
    expect(i).toBeGreaterThanOrEqual(0);
    const block = src.slice(i, i + 800);
    expect(block).toContain(recordCall);
    expect(block).toContain(landPath);

    // (c) Exactly one of each
    expect(src.split(gateExpr).length - 1).toBe(1);
    expect(src.split(landPath).length - 1).toBe(1);
  });
});
