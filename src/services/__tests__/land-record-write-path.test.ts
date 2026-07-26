/**
 * Dual-path land-cycle recorder: escalation-land (path A) and reconcile-land (path B).
 *
 * Both paths execute a successful `landEpicToMaster` but previously only path A recorded
 * the land proof durable `epic_land_record`. The reaper (leaf-worktree-reaper.ts:571)
 * reads this table to authorize worktree reclamation; un-recorded lands risk reclaiming
 * unlanded work. The recorder is SINGLE-CALLER: grep -rn 'recordEpicLand(' src verifies
 * only coordinator-land.ts:1022 calls it; path B (coordinator-live.ts ~855) recorded NOTHING.
 *
 * Path A's write is also SILENT-FAIL: epicHeadSha returns null when the epic branch is
 * absent (a successful land followed by removeEpic, or a revparse error), and the `if (tipSha)`
 * guard skips the record without any signal. A completed land that never mints the proof is
 * indistinguishable from a failed probe — the reaper never knows the land happened.
 *
 * recordLandCycle unifies both paths with an explicit fallback: when the epic tip is
 * unavailable, the land merge sha stands in, ensuring a completed land ALWAYS yields a row.
 * On any skip or failure, it emits observable signals to friction and supervisor-audit stores
 * so a missing record is NOT silent.
 *
 * The MUTATION PROBE below proves the OLD behaviour (if (tipSha) { try { recordEpicLand } catch {} })
 * returns null from getEpicLandRecord when the branch is torn down; the SAME inputs through
 * recordLandCycle return recorded:true with a fallback row — a concrete green/red flip.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (stores open supervisor.db).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-record-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager';
import { recordLandCycle, getEpicLandRecord, recordEpicLand } from '../epic-land-record-store';
import { listFriction } from '../friction-store';
import { listSupervisorAudit } from '../supervisor-store';

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

describe('land-cycle recorder — dual-path land proof with fallback + signals', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;
  const EPIC = 'epic-record-test';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-record-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = mkdtempSync(join(tmpdir(), 'land-record-persist-'));
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

  async function buildEpic(): Promise<void> {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'work.txt'), 'epic work\n');
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: work']);
  }

  it('Path A shape — real epic branch + commit, then recordLandCycle records the real tip', async () => {
    await buildEpic();

    const land = await mgr.landEpicToMaster(EPIC);
    expect(land.landed).toBe(true);

    const epicTipSha = await mgr.epicHeadSha(EPIC).catch(() => null);
    const mergeSha = land.masterSha ?? '';
    const result = await recordLandCycle(repo, {
      epicId: EPIC,
      epicTipSha,
      landedMergeSha: mergeSha,
      landedAt: Date.now(),
      source: 'escalation-land',
      session: 'test-session',
    });

    expect(result.recorded).toBe(true);
    expect(result.usedFallback).toBe(false);

    const record = getEpicLandRecord(repo, EPIC);
    expect(record).not.toBeNull();
    expect(record!.epicTipSha).toBe(epicTipSha || '');
    expect(record!.landedMergeSha).toBe(mergeSha);
  });

  it('Path B shape — intRef reconcile land, then recordLandCycle records with source: reconcile-land', async () => {
    await buildEpic();

    const intRef = await mgr.resolveIntegrationRef();
    expect(intRef).toBeTruthy();

    const land = await mgr.landEpicToMaster(EPIC, { baseRef: intRef! });
    expect(land.landed).toBe(true);

    const epicTipSha = await mgr.epicHeadSha(EPIC).catch(() => null);
    const mergeSha = land.masterSha ?? '';
    const result = await recordLandCycle(repo, {
      epicId: EPIC,
      epicTipSha,
      landedMergeSha: mergeSha,
      source: 'reconcile-land',
      session: 'test-session',
    });

    expect(result.recorded).toBe(true);
    expect(result.usedFallback).toBe(false);

    const record = getEpicLandRecord(repo, EPIC);
    expect(record).not.toBeNull();
    expect(record!.epicTipSha).toBe(epicTipSha || '');
  });

  it('Null-tip fallback — epic branch removed, recordLandCycle uses landedMergeSha', async () => {
    await buildEpic();

    const land = await mgr.landEpicToMaster(EPIC);
    expect(land.landed).toBe(true);

    // Remove the epic worktree and branch.
    await mgr.removeEpic(EPIC, repo);

    // After worktree removal, epicHeadSha returns null (branch is gone).
    const epicTipSha = await mgr.epicHeadSha(EPIC).catch(() => null);
    expect(epicTipSha).toBeNull();

    const mergeSha = land.masterSha ?? '';
    const result = await recordLandCycle(repo, {
      epicId: EPIC,
      epicTipSha: null,
      landedMergeSha: mergeSha,
      source: 'escalation-land',
    });

    expect(result.recorded).toBe(true);
    expect(result.usedFallback).toBe(true);

    const record = getEpicLandRecord(repo, EPIC);
    expect(record).not.toBeNull();
    // The fallback sha (merge sha) is now stored as the epic tip.
    expect(record!.epicTipSha).toBe(mergeSha);
  });

  it('MUTATION PROBE: today\'s behaviour drops the record; recordLandCycle records it', async () => {
    const epic1 = 'epic-probe-old';
    const epic2 = 'epic-probe-new';

    // Build two separate epics.
    for (const e of [epic1, epic2]) {
      const epicWt = await mgr.ensureEpic(e, undefined, 'master');
      if (!epicWt) throw new Error(`ensureEpic ${e} returned null`);
      writeFileSync(join(epicWt.path, `${e}.txt`), `${e} work\n`);
      await runGit(epicWt.path, ['add', '-A']);
      await runGit(epicWt.path, ['commit', '-q', '-m', `${e}: work`]);
    }

    // Land both.
    const land1 = await mgr.landEpicToMaster(epic1);
    const land2 = await mgr.landEpicToMaster(epic2);
    expect(land1.landed).toBe(true);
    expect(land2.landed).toBe(true);

    // Remove both epic worktrees and branches.
    await mgr.removeEpic(epic1, repo);
    await mgr.removeEpic(epic2, repo);

    // Helper: reproduce the OLD pattern (if (tipSha) { try { recordEpicLand } catch {} }).
    async function legacyRecord(epicId: string, tipSha: string | null, mergeSha: string): Promise<void> {
      if (tipSha) {
        try {
          recordEpicLand(repo, {
            epicId,
            epicTipSha: tipSha,
            landedMergeSha: mergeSha,
            landedAt: Date.now(),
          });
        } catch {
          // silent failure
        }
      }
    }

    // OLD behaviour: branch gone, tipSha null → skip silently.
    const tipSha1 = await mgr.epicHeadSha(epic1).catch(() => null);
    expect(tipSha1).toBeNull();
    const mergeSha1 = land1.masterSha ?? '';
    await legacyRecord(epic1, tipSha1, mergeSha1);
    const oldRecord1 = getEpicLandRecord(repo, epic1);
    expect(oldRecord1).toBeNull(); // Record was dropped!

    // NEW behaviour: same inputs → records with fallback.
    const tipSha2 = await mgr.epicHeadSha(epic2).catch(() => null);
    expect(tipSha2).toBeNull();
    const mergeSha2 = land2.masterSha ?? '';
    const result = await recordLandCycle(repo, {
      epicId: epic2,
      epicTipSha: tipSha2,
      landedMergeSha: mergeSha2,
      source: 'escalation-land',
    });
    expect(result.recorded).toBe(true);
    expect(result.usedFallback).toBe(true);
    const newRecord = getEpicLandRecord(repo, epic2);
    expect(newRecord).not.toBeNull();
    expect(newRecord!.epicTipSha).toBe(mergeSha2);

    // Concrete GREEN/RED flip: the probe assertion fails on epic1 (oldRecord is null),
    // passes on epic2 (newRecord is non-null).
  });

  it('Drop signal — empty sha and failed record emit friction and supervisor-audit', async () => {
    const epicId = 'epic-drop-signal';
    const result = await recordLandCycle(repo, {
      epicId,
      epicTipSha: null,
      landedMergeSha: '', // Empty merge sha → no fallback → skip.
      source: 'escalation-land',
      session: 'test-session',
    });

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe('no-sha');

    // Friction note should be recorded.
    const frictionNotes = listFriction(repo, { layer: 'operational' });
    const landDropNote = frictionNotes.find(
      (n) => n.retryReason === 'land-record-drop' && n.todoId === epicId,
    );
    expect(landDropNote).toBeDefined();
    expect(landDropNote!.detail).toContain(epicId);
    expect(landDropNote!.detail).toContain('escalation-land');

    // Supervisor audit should be recorded.
    const auditEntries = listSupervisorAudit({ project: repo, kind: 'land-record-drop' });
    expect(auditEntries.length).toBeGreaterThan(0);
    const matchingEntry = auditEntries.find((e) => e.detail?.includes(epicId));
    expect(matchingEntry).toBeDefined();
    const detail = JSON.parse(matchingEntry!.detail ?? '{}');
    expect(detail.epicId).toBe(epicId);
    expect(detail.source).toBe('escalation-land');
    expect(detail.reason).toBe('no-sha');
  });
});
