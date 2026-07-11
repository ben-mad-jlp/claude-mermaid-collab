import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Isolate the GLOBAL supervisor.db before any imports that touch it.
const supervisorDir = mkdtempSync(join(tmpdir(), 'mc-land-auth-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

// Mock mission-store before importing land-authority.
// getMission is called with (project, todoId) and returns a MissionRow or undefined.
const missions = new Map<string, { status: string; active: boolean; abandonedAt: number | null }>();

mock.module('../mission-store', () => ({
  getMission: (project: string, todoId: string) => {
    const m = missions.get(todoId);
    if (!m) return undefined;
    return {
      todoId,
      status: m.status,
      active: m.active,
      abandonedAt: m.abandonedAt,
      createdAt: 0,
      updatedAt: 0,
      lastNudgeAt: null,
    };
  },
  isMissionTerminal: (m: { status: string; abandonedAt: number | null }) => m.abandonedAt != null || m.status === 'converged',
}));

// Mock todo-store so no real SQLite is touched.
mock.module('../todo-store', () => ({
  listTodos: () => [],
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => ({ completed: { sessionName: '' }, promoted: [], rolledUp: [] }),
  updateTodo: async () => ({}),
  resetTodo: async () => ({}),
  getTodo: () => null,
  reclaimClaim: async () => 'ready',
  releaseClaim: async () => {},
  reclaimOrphan: async () => null,
}));

import {
  isBucketEpic,
  findOwningMission,
  checkLandDeps,
  checkOwnership,
  landReadiness,
  landedByTrailer,
  landAuthority,
  type LandActor,
  type LandProbes,
} from '../land-authority';
import { epicBranchName } from '../epic-branch-status';
import type { LandReadinessReport } from '../epic-land-readiness';
import type { EpicLandGateResult } from '../epic-land-gate';
import type { Todo } from '../todo-store';

afterAll(() => {
  delete process.env.MERMAID_SUPERVISOR_DIR;
  try { rmSync(supervisorDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const PROJECT = '/tmp/mc-land-auth-project';
const SESSION = 'conductor-A';

// ============================================================================
// Fixtures: todo() builder, missions registry, probe factories
// ============================================================================

let seq = 0;

/** `kind` is authoritative now, but these fixtures are written in the older title
 *  dialect ("[EPIC] …", "[MISSION] …", "[LAND] …"). Derive the kind from that prefix
 *  so each fixture stays a one-liner. An explicit `kind` in the partial always wins. */
function inferKind(title: string): Todo['kind'] {
  if (/^\s*\[MISSION\]/i.test(title)) return 'mission';
  if (/^\s*\[EPIC\]/i.test(title)) return 'epic';
  if (/^\s*\[LAND\]/i.test(title)) return 'land';
  return 'leaf';
}

function todo(partial: Partial<Todo> & { id?: string; title: string }): Todo {
  const { title, id, status: statusOverride, ...rest } = partial;
  const status = statusOverride ?? ('ready' as const);
  return {
    id: id ?? `t${++seq}`,
    title,
    kind: inferKind(title),
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
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
    status,
    completed: status === 'done',
    ...rest,
  } as Todo;
}

/**
 * Build the canonical happy-path graph:
 *   [MISSION] converge (m1, active, phase 'execute')
 *     └─ [EPIC] the work (e1)
 *          ├─ leaf: code (l1, done, accepted)
 *          └─ [LAND] merge e1 (d1, dependsOn [l1])
 */
function mkGraph() {
  const m1 = todo({ id: 'm1', title: '[MISSION] converge', ownerSession: SESSION, status: 'ready' });
  const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1', status: 'ready' });
  const l1 = todo({
    id: 'l1',
    title: 'leaf: code',
    parentId: 'e1',
    status: 'done',
    acceptanceStatus: 'accepted',
  });
  const d1 = todo({
    id: 'd1',
    title: '[LAND] merge e1',
    parentId: 'e1',
    dependsOn: ['l1'],
    assigneeKind: 'human',
    status: 'ready',
  });

  // Seed the missions registry with m1 (execute phase, active).
  missions.set('m1', { status: 'needs-discovery', active: true, abandonedAt: null });

  return { m1, e1, l1, d1 };
}

// Probe factories: green by default, parametrisable.
const greenPresence = (): LandReadinessReport => ({
  project: PROJECT,
  epicId: 'e1',
  epicBranch: epicBranchName('e1'),
  blocking: false,
  findings: [],
  exemptions: [],
  duplicateCommits: [],
  checked: 1,
});

const greenGate = (): EpicLandGateResult => ({
  status: 'pass',
  declared: true,
  manifestPath: 'x',
  units: [],
  regressions: [],
  inherited: [],
  incidents: [],
  reasons: [],
  specFiles: [],
  epicTipSha: 'abc',
  baseSha: 'def',
});

const greenMerge = () => ({ tscClean: true, mergeClean: true });

const probes = (over: Partial<LandProbes> = {}): LandProbes => ({
  presence: greenPresence,
  gate: async () => greenGate(),
  merge: greenMerge,
  ...over,
});

// ============================================================================
// Test Suites
// ============================================================================

describe('isBucketEpic', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  const LIVE_BUGFIX_INBOX_TITLE =
    '[EPIC] Bugfix inbox — ad-hoc bugs found while dogfooding; default bucket for stray bugfixes';

  it('[EPIC] Inbox → true', () => {
    expect(isBucketEpic(todo({ title: '[EPIC] Inbox' }))).toBe(true);
  });

  it('[EPIC] Bugfix inbox → true', () => {
    expect(isBucketEpic(todo({ title: '[EPIC] Bugfix inbox' }))).toBe(true);
  });

  it('[EPIC] Collab gaps → true', () => {
    expect(isBucketEpic(todo({ title: '[EPIC] Collab gaps' }))).toBe(true);
  });

  it('case-insensitive: [epic] inbox → true', () => {
    expect(isBucketEpic(todo({ title: '[epic] inbox' }))).toBe(true);
  });

  it('non-bucket epic [EPIC] the work → false', () => {
    expect(isBucketEpic(todo({ title: '[EPIC] the work' }))).toBe(false);
  });

  it('non-epic titled Inbox → false (guards isEpicTodo precondition)', () => {
    expect(isBucketEpic(todo({ title: 'Inbox' }))).toBe(false);
  });

  it('a41c8051: the VERBATIM live Bugfix-inbox title (with suffix) → true', () => {
    expect(isBucketEpic(todo({ title: LIVE_BUGFIX_INBOX_TITLE }))).toBe(true);
  });

  it('[EPIC] Inbox rendering bugs → true (accepted false positive: refuse-by-default)', () => {
    expect(isBucketEpic(todo({ title: '[EPIC] Inbox rendering bugs' }))).toBe(true);
  });

  it('positive control: an ordinary deliverable epic → false', () => {
    expect(isBucketEpic(todo({ title: '[EPIC] The verdict must be evidence, not prose' }))).toBe(false);
  });
});

describe('findOwningMission', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('finds m1 from e1 (one hop)', () => {
    const { m1, e1 } = mkGraph();
    const { mission } = findOwningMission([m1, e1], 'e1');
    expect(mission?.id).toBe('m1');
  });

  it('finds m1 from a grandchild leaf', () => {
    const { m1, e1, l1 } = mkGraph();
    const { mission } = findOwningMission([m1, e1, l1], 'l1');
    expect(mission?.id).toBe('m1');
  });

  it('returns mission: null when no [MISSION] ancestor exists', () => {
    const e1 = todo({ id: 'e1', title: '[EPIC] orphan epic' });
    const { mission } = findOwningMission([e1], 'e1');
    expect(mission).toBe(null);
  });

  it('cycle guard: a.parentId = b, b.parentId = a → returns mission: null', () => {
    const a = todo({ id: 'a', title: '[EPIC] a', parentId: 'b' });
    const b = todo({ id: 'b', title: '[EPIC] b', parentId: 'a' });
    const { mission } = findOwningMission([a, b], 'a');
    expect(mission).toBe(null);
  });

  it('a mission node passed as epicId itself returns itself', () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] self', ownerSession: SESSION });
    const { mission } = findOwningMission([m1], 'm1');
    expect(mission?.id).toBe('m1');
  });
});

describe('checkLandDeps', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('happy graph → null', () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const blocker = checkLandDeps([m1, e1, l1, d1], 'e1');
    expect(blocker).toBe(null);
  });

  it('epic with no [LAND] child → blocker, cites constraint a383bc2c', () => {
    const { m1, e1, l1 } = mkGraph();
    const blocker = checkLandDeps([m1, e1, l1], 'e1');
    expect(blocker?.code).toBe('land-deps-unsatisfied');
    expect(blocker?.message).toMatch(/a383bc2c/);
  });

  it('[LAND] leaf whose dep is status: ready → blocker with short id', () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const readyL1 = { ...l1, status: 'ready' as const };
    const blocker = checkLandDeps([m1, e1, readyL1, d1], 'e1');
    expect(blocker?.code).toBe('land-deps-unsatisfied');
    expect(blocker?.message).toMatch(l1.id.slice(0, 8));
  });

  it('[LAND] leaf whose dep is status: done but acceptanceStatus: rejected → blocker', () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const rejectedL1 = { ...l1, acceptanceStatus: 'rejected' as const };
    const blocker = checkLandDeps([m1, e1, rejectedL1, d1], 'e1');
    expect(blocker?.code).toBe('land-deps-unsatisfied');
  });

  it('unknown epicId → null', () => {
    const { m1 } = mkGraph();
    const blocker = checkLandDeps([m1], 'missing-epic');
    expect(blocker).toBe(null);
  });

  it('≥4 unsatisfied deps → lists at most 3 short ids', () => {
    const { m1, e1 } = mkGraph();
    const deps = [
      todo({ id: 'd1', title: 'dep1', parentId: 'e1', status: 'ready' as const }),
      todo({ id: 'd2', title: 'dep2', parentId: 'e1', status: 'ready' as const }),
      todo({ id: 'd3', title: 'dep3', parentId: 'e1', status: 'ready' as const }),
      todo({ id: 'd4', title: 'dep4', parentId: 'e1', status: 'ready' as const }),
    ];
    const land = todo({
      id: 'land1',
      title: '[LAND] merge',
      parentId: 'e1',
      dependsOn: ['d1', 'd2', 'd3', 'd4'],
    });
    const blocker = checkLandDeps([m1, e1, ...deps, land], 'e1');
    const shortIds = blocker?.message.match(/\b\w{8}\b/g) ?? [];
    expect(shortIds.length).toBeLessThanOrEqual(3);
  });
});

describe('checkOwnership — the ownership rule', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('human actor → { ok: true, ownership: n/a }, no blocker', () => {
    const { m1, e1 } = mkGraph();
    const humanActor = { kind: 'human' } as const;
    const result = checkOwnership(PROJECT, 'e1', humanActor, [m1, e1]);
    expect(result.ok).toBe(true);
    expect(result.ownership).toBe('n/a');
    expect(result.blocker).toBeUndefined();
  });

  it('daemon actor { kind: daemon, level: auto } → { ok: true, ownership: n/a }', () => {
    const { m1, e1 } = mkGraph();
    const daemonActor = { kind: 'daemon', level: 'auto' } as const;
    const result = checkOwnership(PROJECT, 'e1', daemonActor, [m1, e1]);
    expect(result.ok).toBe(true);
    expect(result.ownership).toBe('n/a');
  });

  it('conductor, owned: active mission, owned by actor session → ok: true, ownership: owned', () => {
    const { m1, e1 } = mkGraph();
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'e1', conductorActor, [m1, e1]);
    expect(result.ok).toBe(true);
    expect(result.ownership).toBe('owned');
  });

  it('conductor, bucket epic → ok: false, ownership: bucket, message mentions re-homing', () => {
    const bucket = todo({ id: 'b1', title: '[EPIC] Inbox' });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'b1', conductorActor, [bucket]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('bucket');
    expect(result.blocker?.message).toMatch(/re-home/i);
  });

  it('conductor cannot land the live Bugfix inbox (a41c8051 title) → bucket-epic', () => {
    const LIVE_BUGFIX_INBOX_TITLE =
      '[EPIC] Bugfix inbox — ad-hoc bugs found while dogfooding; default bucket for stray bugfixes';
    const e1 = todo({ id: 'e1', title: LIVE_BUGFIX_INBOX_TITLE });
    const actor: LandActor = { kind: 'conductor', session: SESSION };
    const result = checkOwnership(PROJECT, 'e1', actor, [e1]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('bucket');
    expect(result.blocker?.code).toBe('bucket-epic');
  });

  it('conductor, foreign mission: names the owner and the caller', () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] converge', ownerSession: 'conductor-B' });
    const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1' });
    missions.set('m1', { status: 'needs-discovery', active: true, abandonedAt: null });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'e1', conductorActor, [m1, e1]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('foreign');
    expect(result.blocker?.code).toBe('foreign-mission');
    expect(result.blocker?.message).toMatch(/conductor-B/);
    expect(result.blocker?.message).toMatch(/conductor-A/);
  });

  it('conductor, no mission ancestor → ok: false, ownership: unowned, code: no-active-mission', () => {
    const e1 = todo({ id: 'e1', title: '[EPIC] orphan epic' });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'e1', conductorActor, [e1]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('no-active-mission');
  });

  it('conductor, mission not active (active: false) → no-active-mission', () => {
    const { m1, e1 } = mkGraph();
    missions.set('m1', { status: 'needs-discovery', active: false, abandonedAt: null });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'e1', conductorActor, [m1, e1]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('no-active-mission');
  });

  it('conductor, mission terminal (phase: converged) → no-active-mission', () => {
    const { m1, e1 } = mkGraph();
    missions.set('m1', { status: 'converged', active: true, abandonedAt: null });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'e1', conductorActor, [m1, e1]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('no-active-mission');
  });

  it('conductor, mission row missing entirely → no-active-mission', () => {
    const { m1, e1 } = mkGraph();
    missions.clear(); // Remove the mission from the registry
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'e1', conductorActor, [m1, e1]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('no-active-mission');
  });

  it('conductor, target is not an epic (plain leaf id) → not-an-epic', () => {
    const { m1 } = mkGraph();
    const leaf = todo({ id: 'leaf1', title: 'just a leaf' });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'leaf1', conductorActor, [m1, leaf]);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('not-an-epic');
  });

  it('conductor, unknown epicId → not-an-epic', () => {
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const result = checkOwnership(PROJECT, 'missing-id', conductorActor, []);
    expect(result.ok).toBe(false);
    expect(result.ownership).toBe('unowned');
    expect(result.blocker?.code).toBe('not-an-epic');
  });
});

describe('landReadiness — the one proof', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('green graph + all-green probes → green: true, blockers: [], epicBranch matches, inheritedRed: false', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes(),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.green).toBe(true);
    expect(verdict.blockers).toHaveLength(0);
    expect(verdict.epicBranch).toBe(epicBranchName('e1'));
    expect(verdict.inheritedRed).toBe(false);
  });

  it('merge: tscClean: false → blocker tsc-failed', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ merge: () => ({ tscClean: false, mergeClean: true }) }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.blockers.map((b) => b.code)).toContain('tsc-failed');
  });

  it('merge: mergeClean: false → blocker merge-conflict', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ merge: () => ({ tscClean: true, mergeClean: false }) }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.blockers.map((b) => b.code)).toContain('merge-conflict');
  });

  it('presence blocking: true with one finding → blocker presence-findings with detail', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const blockingPresence = (): LandReadinessReport => ({
      project: PROJECT,
      epicId: 'e1',
      epicBranch: epicBranchName('e1'),
      blocking: true,
      findings: [{ todoId: 'w1', kind: 'missing', title: 'missing work' } as any],
      exemptions: [],
      duplicateCommits: [],
      checked: 1,
    });
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ presence: blockingPresence }),
      todos: [m1, e1, l1, d1],
    });
    const blocker = verdict.blockers.find((b) => b.code === 'presence-findings');
    expect(blocker).toBeDefined();
    expect(blocker?.detail).toMatch(/missing work/);
  });

  it('gate regressions: [unit] → blocker gate-regression', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithRegression = async () => ({
      ...greenGate(),
      regressions: [{ id: 'r1', name: 'test failed' } as any],
    });
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ gate: gateWithRegression }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.blockers.map((b) => b.code)).toContain('gate-regression');
  });

  it('gate inherited: [unit], regressions: [] → inheritedRed: true and green: true', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithInherited = async () => ({
      ...greenGate(),
      inherited: [{ id: 'i1', name: 'inherited issue' } as any],
      regressions: [],
    });
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ gate: gateWithInherited }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.inheritedRed).toBe(true);
    expect(verdict.green).toBe(true);
  });

  it('gate.status: error → blocker gate-error', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithError = async () => ({
      ...greenGate(),
      status: 'error' as const,
      reasons: ['something broke'],
    });
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ gate: gateWithError }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.blockers.map((b) => b.code)).toContain('gate-error');
  });

  it('gate.incidents: [unit] → blocker gate-error', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithIncidents = async () => ({
      ...greenGate(),
      incidents: [{ id: 'inc1', name: 'incident' } as any],
    });
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ gate: gateWithIncidents }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.blockers.map((b) => b.code)).toContain('gate-error');
  });

  it('blocker accumulation: all failures together → collects ALL blockers', async () => {
    const { m1, e1, l1 } = mkGraph();
    // No [LAND] leaf, tsc fails, merge fails, presence blocks, gate regresses
    const gateWithRegression = async () => ({
      ...greenGate(),
      regressions: [{ id: 'r1' } as any],
    });
    const blockingPresence = (): LandReadinessReport => ({
      project: PROJECT,
      epicId: 'e1',
      epicBranch: epicBranchName('e1'),
      blocking: true,
      findings: [{ todoId: 'w1', kind: 'missing', title: 'missing' } as any],
      exemptions: [],
      duplicateCommits: [],
      checked: 1,
    });

    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({
        merge: () => ({ tscClean: false, mergeClean: false }),
        presence: blockingPresence,
        gate: gateWithRegression,
      }),
      todos: [m1, e1, l1],
    });

    const codes = new Set(verdict.blockers.map((b) => b.code));
    expect(codes).toEqual(
      new Set(['land-deps-unsatisfied', 'tsc-failed', 'merge-conflict', 'presence-findings', 'gate-regression']),
    );
  });

  it('gate.declared: false → summary includes "no gate declared"', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateUndeclared = async () => ({
      ...greenGate(),
      declared: false,
    });
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes({ gate: gateUndeclared }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.summary).toMatch(/no gate declared/);
  });

  it('missing [LAND] leaf → summary starts with "[LAND] leaf deps unsatisfied"', async () => {
    const { m1, e1, l1 } = mkGraph();
    const verdict = await landReadiness(PROJECT, 'e1', {
      probes: probes(),
      todos: [m1, e1, l1],
    });
    expect(verdict.summary).toMatch(/^\[LAND\] leaf deps unsatisfied/);
  });
});

describe('landedByTrailer — an irreversible action says who took it', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('human → "Landed-By: human"', () => {
    const trailer = landedByTrailer({ kind: 'human' });
    expect(trailer).toBe('Landed-By: human');
  });

  it('conductor → `Landed-By: conductor:${SESSION}`', () => {
    const trailer = landedByTrailer({ kind: 'conductor', session: SESSION });
    expect(trailer).toBe(`Landed-By: conductor:${SESSION}`);
  });

  it('daemon → "Landed-By: daemon:auto"', () => {
    const trailer = landedByTrailer({ kind: 'daemon', level: 'auto' });
    expect(trailer).toBe('Landed-By: daemon:auto');
  });

  it('trailer injection: session with newline → sanitized (no CRLF)', () => {
    const trailer = landedByTrailer({ kind: 'conductor', session: 'evil\nLanded-By: human' });
    expect(trailer).not.toContain('\n');
    expect(trailer).not.toContain('\r');
    expect(trailer.split('\n')).toHaveLength(1);
  });

  it('session with surrounding whitespace is trimmed', () => {
    const trailer = landedByTrailer({ kind: 'conductor', session: '  conductor-A  ' });
    expect(trailer).toBe('Landed-By: conductor:conductor-A');
  });
});

describe('landAuthority — three actors, one proof', () => {
  beforeEach(() => {
    seq = 0;
    missions.clear();
  });

  it('conductor + owned + green → authorized: true, ownership: owned, trailer, blockers: []', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const verdict = await landAuthority(PROJECT, 'e1', conductorActor, {
      probes: probes(),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.authorized).toBe(true);
    expect(verdict.ownership).toBe('owned');
    expect(verdict.trailer).toBe(`Landed-By: conductor:${SESSION}`);
    expect(verdict.blockers).toHaveLength(0);
  });

  it('conductor + foreign mission + green proof → authorized: false, ownership blocker first', async () => {
    const m1 = todo({ id: 'm1', title: '[MISSION] converge', ownerSession: 'conductor-B' });
    const e1 = todo({ id: 'e1', title: '[EPIC] the work', parentId: 'm1' });
    const l1 = todo({
      id: 'l1',
      title: 'leaf: code',
      parentId: 'e1',
      status: 'done',
      acceptanceStatus: 'accepted',
    });
    const d1 = todo({
      id: 'd1',
      title: '[LAND] merge e1',
      parentId: 'e1',
      dependsOn: ['l1'],
      status: 'ready',
    });
    missions.set('m1', { status: 'needs-discovery', active: true, abandonedAt: null });

    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const verdict = await landAuthority(PROJECT, 'e1', conductorActor, {
      probes: probes(),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.blockers[0].code).toBe('foreign-mission');
  });

  it('conductor + owned + red proof (gate regression) → authorized: false, ownership: owned', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithRegression = async () => ({
      ...greenGate(),
      regressions: [{ id: 'r1' } as any],
    });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const verdict = await landAuthority(PROJECT, 'e1', conductorActor, {
      probes: probes({ gate: gateWithRegression }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.ownership).toBe('owned');
  });

  it('conductor + bucket epic → authorized: false, ownership: bucket', async () => {
    const bucket = todo({ id: 'b1', title: '[EPIC] Inbox' });
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const verdict = await landAuthority(PROJECT, 'b1', conductorActor, {
      probes: probes(),
      todos: [bucket],
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.ownership).toBe('bucket');
  });

  it('conductor + owned + unsatisfied [LAND] deps → authorized: false, code: land-deps-unsatisfied', async () => {
    const { m1, e1, l1 } = mkGraph();
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const verdict = await landAuthority(PROJECT, 'e1', conductorActor, {
      probes: probes(),
      todos: [m1, e1, l1],
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.blockers[0].code).toBe('land-deps-unsatisfied');
  });

  it('human + red proof → authorized: false, ownership: n/a, no weaker than conductor', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithRegression = async () => ({
      ...greenGate(),
      regressions: [{ id: 'r1' } as any],
    });
    const humanActor = { kind: 'human' } as const;
    const verdict = await landAuthority(PROJECT, 'e1', humanActor, {
      probes: probes({ gate: gateWithRegression }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.ownership).toBe('n/a');
  });

  it('daemon:auto + red proof → authorized: false, ownership: n/a', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const gateWithRegression = async () => ({
      ...greenGate(),
      regressions: [{ id: 'r1' } as any],
    });
    const daemonActor = { kind: 'daemon', level: 'auto' } as const;
    const verdict = await landAuthority(PROJECT, 'e1', daemonActor, {
      probes: probes({ gate: gateWithRegression }),
      todos: [m1, e1, l1, d1],
    });
    expect(verdict.authorized).toBe(false);
    expect(verdict.ownership).toBe('n/a');
  });

  it('three actors, identical graph + probes → identical safety slice (green, blockers, inheritedRed, epicBranch)', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const humanActor = { kind: 'human' } as const;
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const daemonActor = { kind: 'daemon', level: 'auto' } as const;

    const verdicts = await Promise.all([
      landAuthority(PROJECT, 'e1', humanActor, {
        probes: probes(),
        todos: [m1, e1, l1, d1],
      }),
      landAuthority(PROJECT, 'e1', conductorActor, {
        probes: probes(),
        todos: [m1, e1, l1, d1],
      }),
      landAuthority(PROJECT, 'e1', daemonActor, {
        probes: probes(),
        todos: [m1, e1, l1, d1],
      }),
    ]);

    const safetySlices = verdicts.map((v) => ({
      green: v.green,
      blockers: v.blockers.map((b) => b.code),
      inheritedRed: v.inheritedRed,
      epicBranch: v.epicBranch,
    }));

    expect(safetySlices[1]).toEqual(safetySlices[0]);
    expect(safetySlices[2]).toEqual(safetySlices[0]);
  });

  it('probe call-count witness: gate and presence invoked exactly once per actor', async () => {
    const { m1, e1, l1, d1 } = mkGraph();
    const humanActor = { kind: 'human' } as const;
    const conductorActor = { kind: 'conductor', session: SESSION } as const;
    const daemonActor = { kind: 'daemon', level: 'auto' } as const;

    let presenceCallCount = 0;
    let gateCallCount = 0;

    const instrumentedPresence = () => {
      presenceCallCount++;
      return greenPresence();
    };

    const instrumentedGate = async () => {
      gateCallCount++;
      return greenGate();
    };

    const todos = [m1, e1, l1, d1];

    await landAuthority(PROJECT, 'e1', humanActor, {
      probes: probes({ presence: instrumentedPresence, gate: instrumentedGate }),
      todos,
    });
    expect(presenceCallCount).toBe(1);
    expect(gateCallCount).toBe(1);

    presenceCallCount = 0;
    gateCallCount = 0;

    await landAuthority(PROJECT, 'e1', conductorActor, {
      probes: probes({ presence: instrumentedPresence, gate: instrumentedGate }),
      todos,
    });
    expect(presenceCallCount).toBe(1);
    expect(gateCallCount).toBe(1);

    presenceCallCount = 0;
    gateCallCount = 0;

    await landAuthority(PROJECT, 'e1', daemonActor, {
      probes: probes({ presence: instrumentedPresence, gate: instrumentedGate }),
      todos,
    });
    expect(presenceCallCount).toBe(1);
    expect(gateCallCount).toBe(1);
  });
});
