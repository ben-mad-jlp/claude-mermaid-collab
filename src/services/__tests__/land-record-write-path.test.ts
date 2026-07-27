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
import { recordLandCycle, getEpicLandRecord, recordEpicLand, captureLandCycleFields } from '../epic-land-record-store';
import type { EpicLandRecord } from '../epic-land-record-store';
import { listFriction } from '../friction-store';
import { listSupervisorAudit } from '../supervisor-store';
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
    // Add .gitignore to exclude .collab directory (created by epic-land-record.db store).
    writeFileSync(join(repo, '.gitignore'), '.collab/\n');
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

  it('Both land paths write the SAME epic_land_record field set for the same land shape', async () => {
    // Shared leaf id: both fixtures use the same id so nonTerminalServingLeafIds is a parity key,
    // not a deliberately-differing one (the fixtures are independent in-memory arrays).
    const NT_LEAF_ID = 'leaf-nt-parity';

    // Real Todo[] fixtures using the hand-built pattern from land-record-fields.test.ts.
    // Each has an epic row + a non-terminal serving-leaf row.
    const todosA: Todo[] = [
      {
        id: EPIC,
        kind: 'epic',
        title: EPIC,
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-parity',
        servesCriterionIds: ['crit-parity'],
        parentId: null,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
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
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
      {
        id: NT_LEAF_ID,
        kind: 'leaf',
        title: 'Non-terminal leaf serving crit-parity',
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-parity',
        servesCriterionIds: ['crit-parity'],
        parentId: EPIC,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
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
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
    ];

    await buildEpic();

    const land = await mgr.landEpicToMaster(EPIC);
    expect(land.landed).toBe(true);
    const mergeSha = land.masterSha ?? '';

    // Capture once for path A (escalation-land) with the real todos fixture.
    const capA = await captureLandCycleFields({
      epicId: EPIC,
      todos: todosA,
      repoRoot: repo,
      epicHeadSha: () => mgr.epicHeadSha(EPIC).catch(() => null),
    });

    // Record path A with an explicit landedAt to control the timestamp.
    const landedAtA = Date.now();
    const resultA = await recordLandCycle(repo, {
      epicId: EPIC,
      epicTipSha: capA.epicTipSha,
      landedMergeSha: mergeSha,
      landedAt: landedAtA,
      source: 'escalation-land',
      session: 'test-a',
      nonTerminalServingLeafIds: capA.nonTerminalServingLeafIds,
      postLandClean: capA.postLandClean,
      landPath: 'escalation-land',
    });
    expect(resultA.recorded).toBe(true);

    const recordA = getEpicLandRecord(repo, EPIC);
    expect(recordA).not.toBeNull();

    // Clean up epic A's worktree to ensure main checkout is clean for path B.
    await mgr.removeEpic(EPIC, repo);

    // Capture and record path B (reconcile-land) with a different epicId to avoid PK conflict.
    const epicB = 'epic-parity-b';
    const wtB = await mgr.ensureEpic(epicB, undefined, 'master');
    if (!wtB) throw new Error('ensureEpic returned null');
    writeFileSync(join(wtB.path, 'work.txt'), 'work\n');
    await runGit(wtB.path, ['add', '-A']);
    await runGit(wtB.path, ['commit', '-q', '-m', 'work']);

    const landB = await mgr.landEpicToMaster(epicB);
    expect(landB.landed).toBe(true);
    const mergeShaB = landB.masterSha ?? '';

    // Fixture B: identical structure to A but with epicB instead of EPIC.
    const todosB: Todo[] = [
      {
        id: epicB,
        kind: 'epic',
        title: epicB,
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-parity',
        servesCriterionIds: ['crit-parity'],
        parentId: null,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
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
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
      {
        id: NT_LEAF_ID,
        kind: 'leaf',
        title: 'Non-terminal leaf serving crit-parity',
        status: 'in_progress',
        acceptanceStatus: null,
        completed: false,
        servesCriterionId: 'crit-parity',
        servesCriterionIds: ['crit-parity'],
        parentId: epicB,
        dependsOn: [],
        order: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        ownerSession: 'test',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
        link: null,
        asanaGid: null,
        sessionName: null,
        executedBySession: null,
        blueprintId: null,
        type: null,
        targetProject: null,
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
        inheritedBlueprintFrom: null,
        inheritedFiles: [],
        isBucket: false,
      } as unknown as Todo,
    ];

    const capB = await captureLandCycleFields({
      epicId: epicB,
      todos: todosB,
      repoRoot: repo,
      epicHeadSha: () => mgr.epicHeadSha(epicB).catch(() => null),
    });

    // Record path B; landedAt defaults to Date.now() via recordLandCycle.
    const resultB = await recordLandCycle(repo, {
      epicId: epicB,
      epicTipSha: capB.epicTipSha,
      landedMergeSha: mergeShaB,
      source: 'reconcile-land',
      session: 'test-b',
      nonTerminalServingLeafIds: capB.nonTerminalServingLeafIds,
      postLandClean: capB.postLandClean,
      landPath: 'oi1-reconcile',
    });
    expect(resultB.recorded).toBe(true);

    const recordB = getEpicLandRecord(repo, epicB);
    expect(recordB).not.toBeNull();

    // Clean up epic B's worktree after recording.
    await mgr.removeEpic(epicB, repo);

    // Assert exact-value captures for both paths: the shared non-terminal leaf drives count=1.
    expect(recordA!.nonTerminalServingLeafCount).toBe(1);
    expect(recordA!.nonTerminalServingLeafIds).toEqual([NT_LEAF_ID]);
    expect(recordB!.nonTerminalServingLeafCount).toBe(1);
    expect(recordB!.nonTerminalServingLeafIds).toEqual([NT_LEAF_ID]);

    // Assert the tmp repo is clean after landEpicToMaster (same concrete pattern as land-record-fields.test.ts:443-444).
    expect(recordA!.postLandStatusClean).toBe(1);
    expect(recordA!.postLandResidue).toBeNull();
    expect(recordB!.postLandStatusClean).toBe(1);
    expect(recordB!.postLandResidue).toBeNull();

    // landPath differs by design.
    expect(recordA!.landPath).toBe('escalation-land');
    expect(recordB!.landPath).toBe('oi1-reconcile');

    // Strip and assert whole-row parity: all columns that MUST NOT differ should be identical.
    type EpicLandRecordNonNull = Omit<typeof recordA, 'epicId' | 'epicTipSha' | 'landedMergeSha' | 'landedAt' | 'landPath'>;
    const strip = (rec: EpicLandRecord): EpicLandRecordNonNull => {
      const copy = { ...rec };
      delete (copy as any).epicId;           // distinct epics
      delete (copy as any).epicTipSha;       // distinct branch tips
      delete (copy as any).landedMergeSha;   // distinct merge commits
      delete (copy as any).landedAt;         // path A passes explicit Date.now(), path B defaults in recordLandCycle
      delete (copy as any).landPath;         // routing tag, differs by design
      return copy as EpicLandRecordNonNull;
    };
    expect(strip(recordA!)).toEqual(strip(recordB!));

    // Call-site routing assertion (unit-test-practical substitute).
    // Driving coordinator-land.ts:1018-1039 and coordinator-live.ts:868-884 end-to-end
    // needs a live escalation/reconcile tick and is out of reach for this store-level test.
    // Instead, read both production files and assert each contains all three routed fields.
    const { readFileSync } = await import('node:fs');
    const coordinatorLandSource = readFileSync(
      new URL('../coordinator-land.ts', import.meta.url).pathname,
      'utf-8'
    );
    const coordinatorLiveSource = readFileSync(
      new URL('../coordinator-live.ts', import.meta.url).pathname,
      'utf-8'
    );

    expect(coordinatorLandSource).toContain('epicTipSha: cycle.epicTipSha');
    expect(coordinatorLandSource).toContain('nonTerminalServingLeafIds: cycle.nonTerminalServingLeafIds');
    expect(coordinatorLandSource).toContain('postLandClean: cycle.postLandClean');

    expect(coordinatorLiveSource).toContain('epicTipSha: cycle.epicTipSha');
    expect(coordinatorLiveSource).toContain('nonTerminalServingLeafIds: cycle.nonTerminalServingLeafIds');
    expect(coordinatorLiveSource).toContain('postLandClean: cycle.postLandClean');
  });

});
