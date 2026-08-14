/**
 * @serial-test-lane: tests a full land cycle that involves git worktree operations
 *
 * Measure once per land (audit O4/O5/O6): inside a single `landEpic` call the steward
 * precheck (validateStewardProof 'land_epic') and the proof stage (landReadiness) used
 * to pay for the same measurements twice:
 *  - O4: tsc + dry-merge — steward's memoized pair, then landReadiness's
 *    defaultMergeProbe re-proving the identical (cwd, sha) pair;
 *  - O5: the G9 presence sweep (getEpicLandReadiness per-leaf `git log --grep`) run by
 *    the steward's unlandedLeaves runner AND landReadiness step 3;
 *  - O6: open-children asked three times (steward store-truth check, landReadiness's
 *    checkLandDeps/checkOpenChildren over the SAME todosAtProofTime snapshot, and the
 *    justified post-proof fresh re-check).
 *
 * The fix threads the steward's measurements into landReadiness, pinned to the shas
 * they were probed at; landReadiness consumes them ONLY while those shas still match
 * its snapshot, else it re-probes fresh.
 *
 * MASTER-FAILS EVIDENCE (verified by stashing the threading change and re-running):
 * on pre-change master the happy-path counting test reds with
 *   tsc probe invocations:      2  (expected 1)
 *   dry-merge probe invocations: 2  (expected 1)
 *   presence sweeps:            2  (expected 1)
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (stores open supervisor.db).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-measure-once-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { realRunners, _resetTscCleanCache, _resetMergeCleanCache } from '../steward-proof';
import { _presenceSweepCounter, _resetPresenceSweepCounter, type LandReadinessReport } from '../epic-land-readiness';
import { createEscalation, addWatchedProject, setProjectDigestEnabled } from '../supervisor-store';
import { createTodo, completeTodo, _closeProject, type Todo } from '../todo-store';
import { landEpic } from '../coordinator-land';
import { getWorktreeManager } from '../coordinator-live';
import { landReadiness, type LandProbes } from '../land-authority';
import type { EpicLandGateResult } from '../epic-land-gate';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
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
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code: code ?? 0, stdout };
}

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

// --- probe invocation counters -----------------------------------------------------
// realRunners is the ONE object both the steward precheck (validateStewardProof spreads
// it at call time) and landReadiness's defaultMergeProbe read their tsc/dry-merge
// predicates from, so wrapping its properties counts every real probe invocation on
// every path through landEpic. Presence sweeps are counted by the _presenceSweepCounter
// seam inside getEpicLandReadiness itself.
const counts = { tsc: 0, merge: 0 };
const origTsc = realRunners.tscClean;
const origMerge = realRunners.epicMergeClean;

beforeEach(() => {
  counts.tsc = 0;
  counts.merge = 0;
  _resetPresenceSweepCounter();
  _resetTscCleanCache();
  _resetMergeCleanCache();
  realRunners.tscClean = (cwd) => {
    counts.tsc++;
    return origTsc(cwd);
  };
  realRunners.epicMergeClean = (masterCwd, epicBranch) => {
    counts.merge++;
    return origMerge(masterCwd, epicBranch);
  };
});

afterEach(() => {
  realRunners.tscClean = origTsc;
  realRunners.epicMergeClean = origMerge;
});

describe('measure once per land — steward proofs thread into landReadiness', () => {
  it('happy path: ONE tsc probe, ONE dry-merge probe, ONE presence sweep per landEpic', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'measure-once-repo-'));
    try {
      await runGit(repo, ['init', '-q', '-b', 'master']);
      await runGit(repo, ['config', 'user.email', 't@t']);
      await runGit(repo, ['config', 'user.name', 'T']);
      writeFileSync(join(repo, '.gitignore'), '.collab/\n');
      writeFileSync(join(repo, 'base.txt'), 'base\n');
      await runGit(repo, ['add', '-A']);
      await runGit(repo, ['commit', '-q', '-m', 'base']);

      addWatchedProject(repo);
      setProjectDigestEnabled(repo, false);

      const epic = await createTodo(repo, {
        allowOrphan: true,
        kind: 'epic',
        ownerSession: 's',
        title: '[EPIC] measure-once',
        status: 'ready',
      });
      const leaf = await createTodo(repo, {
        parentId: epic.id,
        ownerSession: 's',
        title: 'leaf',
      });
      await completeTodo(repo, leaf.id, 'accepted');

      const wm = getWorktreeManager(repo);
      const epicWt = await wm.ensureEpic(epic.id, undefined, 'master');
      if (!epicWt) throw new Error('ensureEpic returned null');
      writeFileSync(join(epicWt.path, 'work.txt'), 'epic work\n');
      await runGit(epicWt.path, ['add', '-A']);
      // Collab-Todo trailer makes the accepted leaf's work provably present on the
      // epic tip, so the REAL G9 presence sweep comes back green.
      await runGit(epicWt.path, ['commit', '-q', '-m', 'epic: work', '-m', `Collab-Todo: ${leaf.id}`]);

      const { escalation } = createEscalation({
        project: repo,
        session: 's',
        kind: 'epic-ready-to-land',
        todoId: leaf.id,
        questionText: 'ready',
        audience: 'internal',
      });

      // Fully REAL stage deps: steward precheck, staleness, proof stage, merge.
      const outcome = await landEpic(repo, escalation.id);
      expect(outcome.landed).toBe(true);

      // THE audit outcome: every measurement taken exactly once per landEpic call.
      // Pre-change master pays double on all three (see file header).
      expect({ tsc: counts.tsc, merge: counts.merge, presence: _presenceSweepCounter.count })
        .toEqual({ tsc: 1, merge: 1, presence: 1 });
    } finally {
      _closeProject(repo);
      try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }, 60_000);

  // --- unit level: landReadiness consumption rules -----------------------------------

  const GREEN_GATE: EpicLandGateResult = {
    status: 'pass',
    declared: true,
    manifestPath: '',
    units: [],
    regressions: [],
    inherited: [],
    incidents: [],
    reasons: [],
    specFiles: [],
    epicTipSha: 'e1',
    baseSha: 'b1',
  };

  function fakeReport(project: string, epicId: string, checked = 42): LandReadinessReport {
    return {
      project,
      epicId,
      epicBranch: 'epic-branch',
      blocking: false,
      findings: [],
      exemptions: [],
      duplicateCommits: [],
      checked,
    };
  }

  function countingProbes(): { probes: LandProbes; calls: { presence: number; gate: number; merge: number } } {
    const calls = { presence: 0, gate: 0, merge: 0 };
    const probes: LandProbes = {
      presence: (p, e) => {
        calls.presence++;
        return fakeReport(p, e, 1);
      },
      gate: async () => {
        calls.gate++;
        return GREEN_GATE;
      },
      merge: () => {
        calls.merge++;
        return { tscClean: true, mergeClean: true };
      },
      worktreeCwd: (project) => project,
    };
    return { probes, calls };
  }

  const SNAPSHOT = { baseSha: 'master-sha-1', epicTipSha: 'tip-sha-1' };

  it('threaded proofs with MATCHING shas are consumed: zero fresh merge/presence probes', async () => {
    const { probes, calls } = countingProbes();
    const threadedPresence = fakeReport('p', 'epic-1');

    const verdict = await landReadiness('p', 'epic-1', {
      todos: [],
      probes,
      snapshot: SNAPSHOT,
      stewardProof: { tscClean: true, mergeClean: true, probedAtShas: { master: SNAPSHOT.baseSha, epicTip: SNAPSHOT.epicTipSha } },
      presence: threadedPresence,
      childrenChecked: true,
    });

    expect(verdict.green).toBe(true);
    // The threaded presence report IS the verdict's presence (checked: 42 marker).
    expect(verdict.presence.checked).toBe(42);
    // Gate always runs; merge + presence consumed the steward's measurements.
    expect(calls).toEqual({ presence: 0, gate: 1, merge: 0 });
  });

  it('sha-moved fallback: trunk moved between stages ⇒ every step re-probes fresh', async () => {
    const { probes, calls } = countingProbes();

    const verdict = await landReadiness('p', 'epic-1', {
      todos: [],
      probes,
      snapshot: SNAPSHOT, // proof-stage sees the MOVED trunk sha
      stewardProof: { tscClean: true, mergeClean: true, probedAtShas: { master: 'stale-master-sha', epicTip: SNAPSHOT.epicTipSha } },
      presence: fakeReport('p', 'epic-1'),
      childrenChecked: true,
    });

    expect(verdict.green).toBe(true);
    // No stale proof consumed: fresh merge probe, fresh presence sweep.
    expect(calls).toEqual({ presence: 1, gate: 1, merge: 1 });
    expect(verdict.presence.checked).toBe(1); // the FRESH probe's report, not the threaded one
  });

  it('no snapshot at readiness time ⇒ threaded proofs are never trusted', async () => {
    const { probes, calls } = countingProbes();

    await landReadiness('p', 'epic-1', {
      todos: [],
      probes,
      // no snapshot
      stewardProof: { tscClean: true, mergeClean: true, probedAtShas: { master: SNAPSHOT.baseSha, epicTip: SNAPSHOT.epicTipSha } },
      presence: fakeReport('p', 'epic-1'),
      childrenChecked: true,
    });

    expect(calls).toEqual({ presence: 1, gate: 1, merge: 1 });
  });

  it('childrenChecked skips the duplicate mid-pipeline children read only under matching shas', async () => {
    // A landed-stamped epic makes checkLandDeps produce a blocker — visible only when
    // the children step actually runs.
    const landedEpic = {
      id: 'epic-1',
      title: '[EPIC] stamped',
      kind: 'epic',
      status: 'in_progress',
      acceptanceStatus: null,
      parentId: null,
      landedAt: '2026-08-01T00:00:00.000Z',
    } as unknown as Todo;

    // Threaded + matching shas: the steward already asked — no land-deps blocker here.
    const { probes: probesA } = countingProbes();
    const threaded = await landReadiness('p', 'epic-1', {
      todos: [landedEpic],
      probes: probesA,
      snapshot: SNAPSHOT,
      stewardProof: { tscClean: true, mergeClean: true, probedAtShas: { master: SNAPSHOT.baseSha, epicTip: SNAPSHOT.epicTipSha } },
      presence: fakeReport('p', 'epic-1'),
      childrenChecked: true,
    });
    expect(threaded.blockers.map((b) => b.code)).not.toContain('land-deps-unsatisfied');

    // Sha mismatch: childrenChecked is NOT trusted either — the check runs and blocks.
    const { probes: probesB } = countingProbes();
    const fallback = await landReadiness('p', 'epic-1', {
      todos: [landedEpic],
      probes: probesB,
      snapshot: SNAPSHOT,
      stewardProof: { tscClean: true, mergeClean: true, probedAtShas: { master: 'stale-master-sha', epicTip: SNAPSHOT.epicTipSha } },
      presence: fakeReport('p', 'epic-1'),
      childrenChecked: true,
    });
    expect(fallback.blockers.map((b) => b.code)).toContain('land-deps-unsatisfied');
  });

  it('external-caller parity: landReadiness WITHOUT threaded proofs behaves byte-identically', async () => {
    const landedEpic = {
      id: 'epic-1',
      title: '[EPIC] stamped',
      kind: 'epic',
      status: 'in_progress',
      acceptanceStatus: null,
      parentId: null,
      landedAt: '2026-08-01T00:00:00.000Z',
    } as unknown as Todo;

    const { probes, calls } = countingProbes();
    const verdict = await landReadiness('p', 'epic-1', {
      todos: [landedEpic],
      probes,
      snapshot: SNAPSHOT,
    });

    // Pinned outputs of the unthreaded path (the pre-change behavior contract):
    // every probe invoked exactly once, the landed-stamp blocker surfaced, summary
    // carries the [LAND]-deps prefix, and the verdict is red.
    expect(calls).toEqual({ presence: 1, gate: 1, merge: 1 });
    expect(verdict.green).toBe(false);
    expect(verdict.blockers.map((b) => b.code)).toEqual(['land-deps-unsatisfied']);
    expect(verdict.blockers[0].message).toContain('already landed');
    expect(verdict.summary.startsWith('[LAND] leaf deps unsatisfied')).toBe(true);
    expect(verdict.presence.checked).toBe(1);
    expect(verdict.inheritedRed).toBe(false);
  });
});
