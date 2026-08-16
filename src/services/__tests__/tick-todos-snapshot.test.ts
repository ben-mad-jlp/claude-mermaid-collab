/**
 * Audit item 7a — ONE todos snapshot per orchestrator tick.
 *
 * Runs via `bun test`. The counting test spies on the todo-store BOUNDARY
 * (`spyOn(todoStore, 'listTodos')` — bun module-namespace spies intercept every
 * cross-module direct-binding call) and drives a REAL tick with the real pass
 * functions (only the gates + non-lane passes are injected), so it counts the
 * genuine full-table scans one tick pays for the threaded passes.
 *
 * MASTER-FAILS EVIDENCE: on master (pre-change, commit 3a3aa7c9) the identical
 * scenario performs 2 listTodos calls — one inside runNotificationTick's diff
 * load and one inside runMissionLoopPass → listMissions — where the threaded
 * tick performs exactly 1 (the tick's own shared snapshot read). The
 * `toHaveBeenCalledTimes(1)` assertion therefore FAILS on master with 2.
 * (With missions present + stall evaluation, master pays 2 more per mission via
 * the un-threaded collectMissionStallFacts getMission/collectMissionStatusFacts
 * pair; the parity tests below cover that path's equivalence.)
 *
 * The parity tests pin that each threaded pass called WITHOUT a snapshot behaves
 * identically to the same pass WITH the equivalent snapshot
 * (`listTodos(project, { includeCompleted: true })`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global stores BEFORE the modules open them.
const supDir = mkdtempSync(join(tmpdir(), 'ticksnap-sup-'));
const dataDir = mkdtempSync(join(tmpdir(), 'ticksnap-data-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;
process.env.MERMAID_DATA_DIR = dataDir;

import * as todoStore from '../todo-store';
import { createTodo, listTodos, completeTodo, openDb, _closeProject } from '../todo-store';
import { runOrchestratorTick, type TickDeps } from '../orchestrator-live';
import { runNotificationTick, __resetTickState } from '../session-notification-tick';
import { addSubscription } from '../session-subscriptions';
import { runMissionLoopPass, _resetOpenStallCards } from '../mission-loop';
import { runMissionIntakePass } from '../mission-intake';
import { runArchivalSweep, _resetArchivalSweepThrottle } from '../archival-sweep';
import { runLandedEpicSweep, terminalizeLandedEpics } from '../landed-epic-sweep';
import { upsertMission, _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeDb as supervisorCloseDb } from '../supervisor-store';
import { _closeDb as orchestratorConfigCloseDb } from '../orchestrator-config';
import type { FrictionLayer } from '../friction-store';

const todoBase = mkdtempSync(join(tmpdir(), 'ticksnap-proj-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { supervisorCloseDb(); orchestratorConfigCloseDb(); });
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  process.env.MERMAID_DATA_DIR = dataDir;
  supervisorCloseDb();
  __resetTickState();
  _resetOpenStallCards();
});
afterAll(() => {
  supervisorCloseDb();
  orchestratorConfigCloseDb(); // drop the cached handle before supDir is removed — a
  // stale open handle into a deleted dir poisons later test files with SQLITE_IOERR
  _closeLedgerDb(); // worker-ledger's singleton binds to MERMAID_SUPERVISOR_DIR at first
  // open — leaving it cached makes the NEXT test file in a batch read THIS file's ledger
  rmSync(supDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_DATA_DIR;
});

describe('one todos snapshot per tick (audit 7a)', () => {
  it('a tick running notify + friction-triage + mission-intake + mission-loop performs exactly ONE listTodos scan (master: 2)', async () => {
    const project = freshProject();
    // ≥1 active subscription so runNotificationTick actually loads todos.
    addSubscription(project, 'sess-snap', 'project');
    await createTodo(project, { ownerSession: 'sess-snap', title: 'seed todo', inbox: true });

    const deps: TickDeps = {
      listProjects: async () => [{ path: project }],
      watchedProjects: () => new Set([project]),
      getLevel: () => 'off', // build/reconcile/archival/landed-epic skipped — not the threaded set under test
      listConfigured: () => [],
      setLevel: () => {},
      dirExists: () => true,
      // Force the threaded passes' gates open; keep the non-lane every-tick passes out.
      shouldRunNotify: () => true,
      shouldRunMissionLoop: () => true,
      shouldRunFrictionTriage: () => true,
      shouldRunMissionIntake: () => true,
      shouldRunFrictionWatch: () => false,
      shouldRunBurnWatch: () => false,
      recycle: async () => ({}),
    };

    const spy = spyOn(todoStore, 'listTodos');
    // The snapshot carries a stamped bugfix bucket — the steady state — so the
    // repair-forge pass resolves it from the snapshot and never reaches ensureBucket's
    // legacy full-table scan (a bucketless project pays that scan once, at creation,
    // where fresh reads are the point).
    spy.mockImplementation(() => ([{
      id: 'bucket-bugfix-seed', title: '[BUCKET] bugfix', kind: 'epic', status: 'planned',
      isBucket: true, bucketType: 'bugfix', parentId: null, dependsOn: [],
      targetProject: '/tmp/does-not-matter',
    } as never]));
    try {
      await runOrchestratorTick(deps);
      // ONE full-table read — the tick's shared snapshot — feeds notify, mission-loop,
      // AND the repair-forge pass (missions via allTodos + bucket resolved from the
      // snapshot); friction-triage/mission-intake perform no scan of their own here.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('tick wiring: friction-triage and mission-intake are SKIPPED when their 7b gates say no, and run when they say yes', async () => {
    const project = freshProject();
    const triageCalls: string[] = [];
    const intakeCalls: string[] = [];
    const base: TickDeps = {
      listProjects: async () => [{ path: project }],
      watchedProjects: () => new Set([project]),
      getLevel: () => 'off',
      listConfigured: () => [],
      setLevel: () => {},
      dirExists: () => true,
      shouldRunNotify: () => false,
      shouldRunMissionLoop: () => false,
      shouldRunFrictionWatch: () => false,
      shouldRunBurnWatch: () => false,
      recycle: async () => ({}),
      frictionTriage: async (p: string) => { triageCalls.push(p); return { filed: 0 }; },
      missionIntake: async (p: string) => { intakeCalls.push(p); return { drafted: null, reason: 'intake-disabled', pending: 0 }; },
    };

    await runOrchestratorTick({ ...base, shouldRunFrictionTriage: () => false, shouldRunMissionIntake: () => false });
    expect(triageCalls).toEqual([]); // throttled off — the pass never ran
    expect(intakeCalls).toEqual([]);

    await runOrchestratorTick({ ...base, shouldRunFrictionTriage: () => true, shouldRunMissionIntake: () => true });
    expect(triageCalls).toEqual([project]); // gate open — the pass ran once
    expect(intakeCalls).toEqual([project]);
  });
});

describe('parity — each threaded pass without a snapshot behaves identically (audit 7a)', () => {
  it('runNotificationTick: snapshot vs self-read produce the same enqueue result', async () => {
    // Two identical projects, one driven with the tick snapshot, one self-reading.
    const results: Array<{ enqueued: number; nudged: string[] }> = [];
    for (const useSnapshot of [true, false]) {
      const project = freshProject();
      addSubscription(project, 'sess-par', 'project');
      const work = await createTodo(project, { ownerSession: 'sess-par', title: 'new work item', inbox: true });
      await runNotificationTick(project); // seed pass — emits nothing
      await completeTodo(project, work.id, 'accepted'); // a change the subscription notifies on
      const snap = useSnapshot ? listTodos(project, { includeCompleted: true }) : undefined;
      results.push(await runNotificationTick(project, snap ? { todosSnapshot: snap } : {}));
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0].enqueued).toBeGreaterThan(0); // and the scenario is non-vacuous
  });

  it('runMissionLoopPass: snapshot vs self-read produce the same result over a real mission', async () => {
    const results: unknown[] = [];
    for (const useSnapshot of [true, false]) {
      const project = freshProject();
      const node = await createTodo(project, { ownerSession: 's1', title: '[MISSION] parity fixture', kind: 'mission' });
      upsertMission(project, node.id);
      const snap = useSnapshot ? listTodos(project, { includeCompleted: true }) : undefined;
      const r = await runMissionLoopPass(project, snap ? { todosSnapshot: snap } : {});
      // Normalize per-project random ids to counts — the SHAPE of the outcome is the parity claim.
      results.push({ nudged: (r as { nudged: string[] }).nudged.length, skipped: (r as { skipped: number }).skipped, stalled: (r as { stalled: string[] }).stalled.length });
      _resetMissionDbCache(project);
      _closeProject(project);
    }
    expect(results[0]).toEqual(results[1]);
  });

  it('runMissionIntakePass: the snapshot feeds the dedup surface identically to a self-read', async () => {
    const trends = {
      total: 9, considered: 9,
      byLayer: [{ layer: 'domain' as FrictionLayer, count: 9, reasons: [{ retryReason: 'flaky-gate', count: 9, sessions: ['a', 'b', 'c'], lastAt: new Date().toISOString(), defectClass: 'defect' as const }] }],
      recurring: [],
    };
    const results: unknown[] = [];
    for (const useSnapshot of [true, false]) {
      const project = freshProject();
      // An open triage bug todo covering the cluster's reason → surface-1 dedup refuses.
      await createTodo(project, { ownerSession: 's1', title: '[bug] Recurring friction: flaky-gate (domain)', triageTag: 'domain', inbox: true });
      const snap = useSnapshot ? listTodos(project, { includeCompleted: true }) : undefined;
      const r = await runMissionIntakePass(project, {
        ...(snap ? { todosSnapshot: snap } : {}),
        trends: () => trends,
        intakeEnabled: () => true,
        isActioned: () => false,
        listMissions: () => [],
        getProvenance: () => null,
        forge: async () => { throw new Error('forge must NOT be reached — dedup covers the cluster'); },
      });
      results.push(r);
      _closeProject(project);
    }
    expect(results[0]).toEqual(results[1]);
    expect((results[0] as { reason: string }).reason).toBe('no-eligible-cluster'); // dedup engaged, not vacuous
  });

  it('runArchivalSweep: snapshot vs chunked self-read archive the same rows', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const oldIso = new Date(Date.now() - 40 * DAY_MS).toISOString();
    const results: Array<{ todosArchived: number; missionsArchived: number }> = [];
    for (const useSnapshot of [true, false]) {
      const project = freshProject();
      _resetArchivalSweepThrottle(project);
      const done = await createTodo(project, { ownerSession: 's1', title: 'long done', inbox: true });
      await completeTodo(project, done.id, 'accepted');
      openDb(project).prepare('UPDATE todos SET completedAt = ?, updatedAt = ? WHERE id = ?').run(oldIso, oldIso, done.id);
      const live = await createTodo(project, { ownerSession: 's1', title: 'still live', inbox: true });
      const snap = useSnapshot ? listTodos(project, { includeCompleted: true }) : undefined;
      results.push(await runArchivalSweep(project, { force: true, ...(snap ? { todosSnapshot: snap } : {}) }));
      expect(todoStore.getTodo(project, live.id)).toBeDefined(); // live row untouched either way
      _closeProject(project);
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0].todosArchived).toBe(1); // non-vacuous: the old terminal row was archived
  });

  it('runLandedEpicSweep + terminalizeLandedEpics: snapshot vs self-read produce the same result', async () => {
    const probe = async () => ({ exists: false, ahead: 0, behind: 0, mergeable: true, newCount: 0 });
    const results: unknown[] = [];
    for (const useSnapshot of [true, false]) {
      const project = freshProject();
      await createTodo(project, { ownerSession: 's1', title: '[EPIC] unlanded parity fixture', kind: 'epic' });
      const snap = useSnapshot ? listTodos(project, { includeCompleted: true }) : undefined;
      const term = await terminalizeLandedEpics(project, {
        ...(snap ? { todos: snap } : {}),
        landCommit: async () => ({ status: 'not-landed' as const, sha: null, committedAtIso: null }),
      });
      const sweep = await runLandedEpicSweep(project, {
        force: true,
        probe: probe as never,
        baseRef: 'master',
        runner: {
          revParse: async () => null,
          deleteBranch: async () => false,
          listEpicBranches: async () => [],
          aheadCount: async () => -1,
        },
        ...(snap ? { todosSnapshot: snap } : {}),
      });
      results.push({ term, gc: sweep.gc, reconcile: sweep.reconcile, promoted: sweep.promoted });
      _closeProject(project);
    }
    expect(results[0]).toEqual(results[1]);
  });
});
