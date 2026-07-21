/**
 * Topology test for land authority: ALL THREE ACTORS call ONE proof, NO BYPASS.
 *
 * The acceptance clause: *All three actors call the identical `landReadiness()`;
 * a test proves no path bypasses it.* This file verifies the topology of the land
 * system — that human/conductor/daemon converge on a single safety proof that is
 * never bypassed, and that ownership gates authority (not safety).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'land-single-path-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landReadiness, landAuthority, landedByTrailer, checkLandDeps, type LandActor, type LandProbes } from '../land-authority';
import { createTodo, updateTodo, getTodo, listTodos, stampEpicLandedAt, _closeProject, type Todo } from '../todo-store';
import { upsertMission } from '../mission-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { _closeLedgerDb } from '../worker-ledger';
import type { EpicLandGateResult, EpicLandGateOpts } from '../epic-land-gate';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land-proof-single-path — topology verification', () => {
  let project: string;
  let m1: Todo;
  let epic: Todo;
  let codeLeaf: Todo;
  let landLeaf: Todo;
  let inboxEpic: Todo;

  const GREEN_GATE: EpicLandGateResult = {
    status: 'pass',
    declared: true,
    manifestPath: '',
    typecheck: { command: 'tsc', status: 'pass', output: '' },
    units: [],
    regressions: [],
    inherited: [],
    incidents: [],
    reasons: [],
    specFiles: [],
    epicTipSha: 'abc123',
    baseSha: 'def456',
  };

  function countingProbes(over?: Partial<LandProbes>): { probes: LandProbes; calls: { presence: number; gate: number; merge: number } } {
    const calls = { presence: 0, gate: 0, merge: 0 };
    const probes: LandProbes = {
      presence: (p, e) => {
        calls.presence++;
        return {
          project: p,
          epicId: e,
          epicBranch: `feature/${e.slice(0, 8)}`,
          blocking: false,
          findings: [],
          exemptions: [],
          duplicateCommits: [],
          checked: 1,
        };
      },
      gate: async (opts: EpicLandGateOpts) => {
        calls.gate++;
        return GREEN_GATE;
      },
      merge: (p, b, w) => {
        calls.merge++;
        return { tscClean: true, mergeClean: true };
      },
      ...(over ?? {}),
    };
    return { probes, calls };
  }

  const HUMAN: LandActor = { kind: 'human' };
  const CONDUCTOR: LandActor = { kind: 'conductor', session: 'sess-A' };
  const DAEMON: LandActor = { kind: 'daemon', level: 'auto' };

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), 'land-proof-repo-'));
    _closeProject(project);

    // Mission m1 owned by conductor sess-A
    m1 = (await createTodo(project, {
      allowOrphan: true,
      title: '[MISSION] m1',
      kind: 'mission',
      ownerSession: 'sess-A',
    })) as Todo;

    // Epic under m1
    epic = (await createTodo(project, {
      title: '[EPIC] deliverable',
      kind: 'epic',
      parentId: m1.id,
      ownerSession: 'sess-A',
    })) as Todo;

    // Code leaf (done + accepted — checkLandDeps' derived-sibling predicate requires
    // acceptanceStatus === 'accepted' exactly; createTodo cannot set it directly, so
    // it's patched in via updateTodo right after create).
    codeLeaf = (await createTodo(project, {
      title: 'code',
      parentId: epic.id,
      status: 'done',
      ownerSession: 'sess-A',
    })) as Todo;
    codeLeaf = (await updateTodo(project, codeLeaf.id, { acceptanceStatus: 'accepted' })) as Todo;

    // [LAND] leaf depending on code
    landLeaf = (await createTodo(project, {
      title: '[LAND] merge deliverable',
      kind: 'land',
      parentId: epic.id,
      dependsOn: [codeLeaf.id],
      ownerSession: 'sess-A',
    })) as Todo;

    // Inbox bucket (never landable)
    inboxEpic = (await createTodo(project, {
      allowOrphan: true,
      title: '[EPIC] Inbox',
      kind: 'epic',
      ownerSession: 'sess-A',
    })) as Todo;

    // Activate the mission
    upsertMission(project, m1.id);
  });

  afterEach(() => {
    _closeProject(project);
    _closeLedgerDb();
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test 1 — proof is byte-identical across all three actors (green)', async () => {
    const { probes: probes1, calls: calls1 } = countingProbes();
    const { probes: probes2, calls: calls2 } = countingProbes();
    const { probes: probes3, calls: calls3 } = countingProbes();
    const { probes: probes4, calls: calls4 } = countingProbes();

    const allTodos = listTodos(project, { includeCompleted: true });

    // Call landAuthority once per actor
    const humanVerdict = await landAuthority(project, epic.id, HUMAN, { probes: probes1, todos: allTodos });
    const conductorVerdict = await landAuthority(project, epic.id, CONDUCTOR, { probes: probes2, todos: allTodos });
    const daemonVerdict = await landAuthority(project, epic.id, DAEMON, { probes: probes3, todos: allTodos });

    // Call bare landReadiness
    const readinessVerdict = await landReadiness(project, epic.id, { probes: probes4, todos: allTodos });

    // Extract the core (readiness fields, unaffected by actor)
    const core = (v: any) => ({
      green: v.green,
      epicBranch: v.epicBranch,
      inheritedRed: v.inheritedRed,
      summary: v.summary,
      blockers: v.blockers.map((b: any) => b.code),
    });

    const humanCore = core(humanVerdict);
    const conductorCore = core(conductorVerdict);
    const daemonCore = core(daemonVerdict);
    const readinessCore = core(readinessVerdict);

    // All four verdicts have identical readiness cores
    expect(humanCore).toEqual(readinessCore);
    expect(conductorCore).toEqual(readinessCore);
    expect(daemonCore).toEqual(readinessCore);
  });

  it('test 2 — no actor skips a check (probe invocation counting)', async () => {
    const { probes: probes1, calls: calls1 } = countingProbes();
    const { probes: probes2, calls: calls2 } = countingProbes();
    const { probes: probes3, calls: calls3 } = countingProbes();
    const { probes: probes4, calls: calls4 } = countingProbes();

    const allTodos = listTodos(project, { includeCompleted: true });

    // Call all three actors
    await landAuthority(project, epic.id, HUMAN, { probes: probes1, todos: allTodos });
    await landAuthority(project, epic.id, CONDUCTOR, { probes: probes2, todos: allTodos });
    await landAuthority(project, epic.id, DAEMON, { probes: probes3, todos: allTodos });

    // Call bare landReadiness
    await landReadiness(project, epic.id, { probes: probes4, todos: allTodos });

    // Each must invoke all three probes exactly once
    expect(calls1).toEqual({ presence: 1, gate: 1, merge: 1 });
    expect(calls2).toEqual({ presence: 1, gate: 1, merge: 1 });
    expect(calls3).toEqual({ presence: 1, gate: 1, merge: 1 });
    expect(calls4).toEqual({ presence: 1, gate: 1, merge: 1 });
  });

  it('test 3 — a red proof refuses EVERY actor (ownership never weakens safety)', async () => {
    // Override merge probe to fail
    const { probes: probes1 } = countingProbes({ merge: () => ({ tscClean: true, mergeClean: false }) });
    const { probes: probes2 } = countingProbes({ merge: () => ({ tscClean: true, mergeClean: false }) });
    const { probes: probes3 } = countingProbes({ merge: () => ({ tscClean: true, mergeClean: false }) });

    const allTodos = listTodos(project, { includeCompleted: true });

    const humanVerdict = await landAuthority(project, epic.id, HUMAN, { probes: probes1, todos: allTodos });
    const conductorVerdict = await landAuthority(project, epic.id, CONDUCTOR, { probes: probes2, todos: allTodos });
    const daemonVerdict = await landAuthority(project, epic.id, DAEMON, { probes: probes3, todos: allTodos });

    // All three must refuse, and all must have merge-conflict blocker
    expect(humanVerdict.green).toBe(false);
    expect(humanVerdict.authorized).toBe(false);
    expect(humanVerdict.blockers.map((b) => b.code)).toContain('merge-conflict');

    expect(conductorVerdict.green).toBe(false);
    expect(conductorVerdict.authorized).toBe(false);
    expect(conductorVerdict.blockers.map((b) => b.code)).toContain('merge-conflict');

    expect(daemonVerdict.green).toBe(false);
    expect(daemonVerdict.authorized).toBe(false);
    expect(daemonVerdict.blockers.map((b) => b.code)).toContain('merge-conflict');
  });

  it('test 4 — ownership gates only authority, never the proof (conductor:foreign)', async () => {
    const foreignConductor: LandActor = { kind: 'conductor', session: 'sess-B' };
    const { probes } = countingProbes();
    const allTodos = listTodos(project, { includeCompleted: true });

    const verdict = await landAuthority(project, epic.id, foreignConductor, { probes, todos: allTodos });

    // Green proof but unauthorized (foreign mission)
    expect(verdict.green).toBe(true);
    expect(verdict.authorized).toBe(false);
    expect(verdict.ownership).toBe('foreign');
    expect(verdict.blockers[0].code).toBe('foreign-mission');
    expect(verdict.blockers[0].message).toContain('sess-A');

    // Probes were still invoked (readiness computed regardless of ownership)
    const allTodos2 = listTodos(project, { includeCompleted: true });
    const { probes: probes2, calls: calls2 } = countingProbes();
    await landAuthority(project, epic.id, foreignConductor, { probes: probes2, todos: allTodos2 });
    expect(calls2).toEqual({ presence: 1, gate: 1, merge: 1 });
  });

  it('test 4b — ownership gates only authority (bucket epic)', async () => {
    const { probes } = countingProbes();
    const allTodos = listTodos(project, { includeCompleted: true });

    const verdict = await landAuthority(project, inboxEpic.id, CONDUCTOR, { probes, todos: allTodos });

    // Bucket epic is refused at ownership level
    expect(verdict.authorized).toBe(false);
    expect(verdict.ownership).toBe('bucket');
    expect(verdict.blockers[0].code).toBe('bucket-epic');

    // landReadiness on same epic is unaffected by actor. The inbox epic has zero
    // children, so the derived sibling barrier is vacuously satisfied — it is the
    // ownership check (bucket-epic, asserted above) that refuses this epic, not
    // checkLandDeps (W4 cutover: no land-leaf-existence requirement).
    const readinessBucket = await landReadiness(project, inboxEpic.id, { probes, todos: allTodos });
    expect(readinessBucket.blockers.map((b) => b.code)).not.toContain('land-deps-unsatisfied');
  });

  it('test 4c — checkLandDeps returns null for landedAt:null with zero land-leaf siblings (W4 cutover)', async () => {
    // A fresh epic + one land-kind child ONLY (no build children at all): the
    // sibling barrier excludes land-kind todos via isLandTodo, so there are zero
    // gating siblings and the barrier is vacuously satisfied — no land-leaf
    // existence check remains in checkLandDeps.
    const bareEpic = (await createTodo(project, {
      title: '[EPIC] bare',
      kind: 'epic',
      parentId: m1.id,
      ownerSession: 'sess-A',
    })) as Todo;
    await createTodo(project, {
      title: '[LAND] merge bare',
      kind: 'land',
      parentId: bareEpic.id,
      ownerSession: 'sess-A',
    });
    const allTodos = listTodos(project, { includeCompleted: true });
    expect(bareEpic.landedAt).toBeNull();
    expect(checkLandDeps(allTodos, bareEpic.id)).toBeNull();
  });

  it('test 4d — checkLandDeps returns land-deps-unsatisfied citing landedAt when already landed', async () => {
    const landedAt = new Date().toISOString();
    stampEpicLandedAt(project, epic.id, landedAt);
    const allTodos = listTodos(project, { includeCompleted: true });
    const blocker = checkLandDeps(allTodos, epic.id);
    expect(blocker).not.toBeNull();
    expect(blocker!.code).toBe('land-deps-unsatisfied');
    expect(blocker!.message).toContain('already landed');
    expect(blocker!.message).toContain(landedAt);
  });

  it('test 4e — legacy epic with a done land leaf child (no epic.landedAt) still resolves via the sibling barrier', async () => {
    const legacyEpic = (await createTodo(project, {
      title: '[EPIC] legacy',
      kind: 'epic',
      parentId: m1.id,
      ownerSession: 'sess-A',
    })) as Todo;
    const legacyLeaf = (await createTodo(project, {
      title: 'legacy work',
      parentId: legacyEpic.id,
      status: 'done',
      ownerSession: 'sess-A',
    })) as Todo;
    await updateTodo(project, legacyLeaf.id, { acceptanceStatus: 'accepted' });
    await createTodo(project, {
      title: '[LAND] merge legacy',
      kind: 'land',
      parentId: legacyEpic.id,
      status: 'done',
      dependsOn: [legacyLeaf.id],
      ownerSession: 'sess-A',
    });
    const allTodos = listTodos(project, { includeCompleted: true });
    const refreshedEpic = allTodos.find((t) => t.id === legacyEpic.id)!;
    expect(refreshedEpic.landedAt).toBeNull();
    expect(checkLandDeps(allTodos, legacyEpic.id)).toBeNull();
  });

  it('test 5 — trailer parity (actor is recorded, proof is unaffected)', async () => {
    const { probes: probes1 } = countingProbes();
    const { probes: probes2 } = countingProbes();
    const { probes: probes3 } = countingProbes();

    const allTodos = listTodos(project, { includeCompleted: true });

    const humanVerdict = await landAuthority(project, epic.id, HUMAN, { probes: probes1, todos: allTodos });
    const conductorVerdict = await landAuthority(project, epic.id, CONDUCTOR, { probes: probes2, todos: allTodos });
    const daemonVerdict = await landAuthority(project, epic.id, DAEMON, { probes: probes3, todos: allTodos });

    // Trailers are distinct
    expect(humanVerdict.trailer).toBe('Landed-By: human');
    expect(conductorVerdict.trailer).toBe('Landed-By: conductor:sess-A');
    expect(daemonVerdict.trailer).toBe('Landed-By: daemon:auto');

    // But readiness core is identical
    const core = (v: any) => ({
      green: v.green,
      epicBranch: v.epicBranch,
      inheritedRed: v.inheritedRed,
      blockers: v.blockers.map((b: any) => b.code),
    });

    expect(core(humanVerdict)).toEqual(core(conductorVerdict));
    expect(core(humanVerdict)).toEqual(core(daemonVerdict));

    // Also verify trailer helpers
    expect(landedByTrailer(HUMAN)).toBe('Landed-By: human');
    expect(landedByTrailer(CONDUCTOR)).toBe('Landed-By: conductor:sess-A');
    expect(landedByTrailer(DAEMON)).toBe('Landed-By: daemon:auto');
  });

  it('test 6a — one trunk merge primitive (landEpicToMaster in coordinator-live/coordinator-land only)', () => {
    // landEpic (and its wm.landEpicToMaster call) MOVED to coordinator-land.ts — the
    // landing subsystem was extracted out of coordinator-live.ts (MOVE ONLY). The OI-1
    // integration-land call site stayed behind in coordinator-live.ts.
    const coordinatorLivePath = join(import.meta.dir, '../../services/coordinator-live.ts');
    const coordinatorLandPath = join(import.meta.dir, '../../services/coordinator-land.ts');
    const liveContent = readFileSync(coordinatorLivePath, 'utf8');
    const landContent = readFileSync(coordinatorLandPath, 'utf8');
    const liveMatches = liveContent.match(/wm\.landEpicToMaster\(/g);
    const landMatches = landContent.match(/wm\.landEpicToMaster\(/g);

    // Should appear exactly 2 times total: OI-1 integration land (coordinator-live.ts)
    // + trunk land inside landEpic (coordinator-land.ts)
    expect((liveMatches?.length ?? 0) + (landMatches?.length ?? 0)).toBe(2);

    // Verify no other file in src/ has landEpicToMaster (excluding tests and worktree-manager def)
    const srcDir = join(import.meta.dir, '../../');
    const files = walkSync(srcDir, (f) => !f.includes('__tests__') && !f.includes('worktree-manager.ts'));
    const filesWithMerge = files.filter((f) => {
      try {
        const content = readFileSync(f, 'utf8');
        return content.includes('landEpicToMaster(');
      } catch {
        return false;
      }
    }).sort();

    expect(filesWithMerge).toEqual([coordinatorLandPath, coordinatorLivePath].sort());
  });

  it('test 6b — proof precedes merge inside landEpic', () => {
    // landEpic MOVED to coordinator-land.ts (landing-subsystem extraction).
    const coordinatorPath = join(import.meta.dir, '../../services/coordinator-land.ts');
    const content = readFileSync(coordinatorPath, 'utf8');

    // Find the landEpic function body
    const landEpicStart = content.indexOf('export async function landEpic(');
    expect(landEpicStart).toBeGreaterThan(-1);

    const nextExport = content.indexOf('\nexport ', landEpicStart + 1);
    const landEpicBody = content.slice(landEpicStart, nextExport === -1 ? undefined : nextExport);

    // Proof derivation must come before merge
    const proofIdx = landEpicBody.indexOf('deriveEpicLandProof(');
    const mergeIdx = landEpicBody.indexOf('landEpicToMaster(');
    const refusalIdx = landEpicBody.indexOf('if (!proof.ok)');

    expect(proofIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(-1);
    expect(refusalIdx).toBeGreaterThan(-1);
    expect(proofIdx).toBeLessThan(refusalIdx);
    expect(refusalIdx).toBeLessThan(mergeIdx);
  });

  it('test 6c — entrypoint allowlist is exactly 3 files', () => {
    const srcDir = join(import.meta.dir, '../../');
    const files = walkSync(srcDir, (f) => !f.includes('__tests__'));

    const filesWithLandEpic = files.filter((f) => {
      try {
        const content = readFileSync(f, 'utf8');
        return content.includes('landEpic(');
      } catch {
        return false;
      }
    }).sort();

    // landEpic's definition (and surfaceEpicLand's call into it) MOVED to
    // coordinator-land.ts — coordinator-live.ts now only re-exports the symbol
    // (`landEpic,` with no call-paren), so it drops off this allowlist.
    const expected = [
      join(srcDir, 'services/coordinator-land.ts'),
      join(srcDir, 'routes/supervisor-routes.ts'),
      join(srcDir, 'mcp/setup.ts'),
    ].sort();

    expect(filesWithLandEpic).toEqual(expected);
  });

  it('test 6d — each entrypoint is on the proof', () => {
    const supervisorPath = join(import.meta.dir, '../../routes/supervisor-routes.ts');
    const mcpPath = join(import.meta.dir, '../../mcp/setup.ts');
    // autoLandReadiness MOVED to coordinator-land.ts (landing-subsystem extraction).
    const coordinatorPath = join(import.meta.dir, '../../services/coordinator-land.ts');

    const supervisorContent = readFileSync(supervisorPath, 'utf8');
    const mcpContent = readFileSync(mcpPath, 'utf8');
    const coordinatorContent = readFileSync(coordinatorPath, 'utf8');

    // supervisor-routes calls landAuthority
    expect(supervisorContent).toContain('landAuthority(');
    // mcp/setup calls checkOwnership
    expect(mcpContent).toContain('checkOwnership(');
    // coordinator-land calls autoLandReadiness
    expect(coordinatorContent).toContain('autoLandReadiness(');
  });

  it('test 6e — autoLandReadiness is a pure delegation to landReadiness', () => {
    // autoLandReadiness MOVED to coordinator-land.ts (landing-subsystem extraction).
    const coordinatorPath = join(import.meta.dir, '../../services/coordinator-land.ts');
    const content = readFileSync(coordinatorPath, 'utf8');

    // Find autoLandReadiness function
    const funcStart = content.indexOf('export async function autoLandReadiness(');
    expect(funcStart).toBeGreaterThan(-1);

    const funcEnd = content.indexOf('\n}', funcStart);
    const funcBody = content.slice(funcStart, funcEnd);

    // Must contain exact delegation pattern (loose whitespace matching)
    const pattern = /return\s+landReadiness\(\s*repo\s*,\s*epicId\s*,\s*\{\s*todos\s*\}\s*\)/;
    expect(funcBody).toMatch(pattern);
  });
});

/** Walk src/ recursively, returning file paths, skipping __tests__ and matching filterFn */
function walkSync(dir: string, filterFn: (path: string) => boolean): string[] {
  const results: string[] = [];

  function walk(d: string) {
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          if (filterFn(fullPath)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      /* skip unreadable dirs */
    }
  }

  walk(dir);
  return results;
}
