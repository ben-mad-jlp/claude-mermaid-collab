import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, claimTodo, _closeProject } from '../todo-store';
import { upsertMission, addCriterion } from '../mission-store';
import { buildMissionDiagnostic, classifyLeafTerminal } from '../mission-diagnostic';
import type { LeafRunSummary } from '../ledger-stats';
import { openPassRow, finalizePassRow, _closeConductorJournalDb, type ConductorPassArm } from '../conductor-pass-journal';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-diagnostic-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _closeConductorJournalDb();
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function makeFixture() {
  const m = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: 'Mission: converge',
    kind: 'mission',
  });
  upsertMission(project, m.id);
  const c = addCriterion(project, m.id, 'the capability under test');
  const e = await createTodo(project, {
    ownerSession: 's1',
    title: '[EPIC] serve',
    kind: 'epic',
    parentId: m.id,
    servesCriterionIds: [c.id],
  });
  return { m, c, e };
}

describe('buildMissionDiagnostic', () => {
  test('serving epic landed in git yields landedInGit true even with landedAt unset', async () => {
    const { m, e } = await makeFixture();
    const result = await buildMissionDiagnostic(project, m.id, {
      isEpicLandedInGit: async () => 'landed',
    });
    const crit = result.criteria[0];
    const servingEpic = crit.servingEpics.find((s) => s.id === e.id)!;
    expect(servingEpic.landedInGit).toBe(true);
  });

  test('a throwing git probe resolves landedInGit null without rejecting, rollup still populated', async () => {
    const { m, e } = await makeFixture();
    const result = await buildMissionDiagnostic(project, m.id, {
      isEpicLandedInGit: async () => {
        throw new Error('boom');
      },
    });
    const crit = result.criteria[0];
    const servingEpic = crit.servingEpics.find((s) => s.id === e.id)!;
    expect(servingEpic.landedInGit).toBeNull();
    expect(result.rollup).not.toBeNull();
    expect(result.rollup!.todoId).toBe(m.id);
  });

  test('result always carries status, rollup, criteria, leaves, conductorPass, baseHealth keys', async () => {
    const { m } = await makeFixture();
    const result = await buildMissionDiagnostic(project, m.id, {
      isEpicLandedInGit: async () => 'landed',
    });
    expect(Object.keys(result).sort()).toEqual(
      ['baseHealth', 'conductorPass', 'criteria', 'hostLoad', 'leaves', 'rollup', 'status'].sort(),
    );
  });

  test('rejects an unresolvable project instead of returning a null-field diagnostic', async () => {
    await expect(buildMissionDiagnostic('/nonexistent/definitely-not-a-project', 'deadbeef')).rejects.toThrow(
      /nonexistent\/definitely-not-a-project/,
    );
    expect(existsSync(join('/nonexistent/definitely-not-a-project', '.collab'))).toBe(false);
  });

  test('rejects a non-absolute project instead of resolving against server cwd', async () => {
    await expect(buildMissionDiagnostic('mermaid-collab', 'deadbeef')).rejects.toThrow(
      /mermaid-collab/,
    );
    await expect(buildMissionDiagnostic('mermaid-collab', 'deadbeef')).rejects.toThrow(
      /absolute|resolveProjectArg/,
    );
  });

  test('rejects an unknown missionId under a real project instead of returning a null-field diagnostic', async () => {
    await expect(buildMissionDiagnostic(project, 'ffffffff-not-a-real-mission')).rejects.toThrow(
      /ffffffff-not-a-real-mission/,
    );
  });
});

const NO_GIT = { isEpicLandedInGit: async () => 'indeterminate' as const, epicHeadSha: async () => null };

function addFinalizedPass(missionId: string, startedAt: number, outcome: string, arm: ConductorPassArm = 'node', ran = true) {
  const id = openPassRow(project, missionId, startedAt);
  expect(id).not.toBeNull();
  finalizePassRow(id!, { outcome, ran, arm, endedAt: startedAt + 1 });
}

describe('buildMissionDiagnostic conductorPass', () => {
  test('three finalized debounced passes yield debouncedStreak 3', async () => {
    const { m } = await makeFixture();
    addFinalizedPass(m.id, 1000, 'debounced');
    addFinalizedPass(m.id, 2000, 'debounced');
    addFinalizedPass(m.id, 3000, 'debounced');
    const r = await buildMissionDiagnostic(project, m.id, { ...NO_GIT, now: () => 4000 });
    expect(r.conductorPass.debouncedStreak).toBe(3);
    expect(r.conductorPass.isInflight).toBe(false);
    expect(r.conductorPass.lastPassAt).toBe(3000);
    expect(r.conductorPass.staleSeconds).toBe(1);
  });

  test('a non-debounced pass between debounced runs stops the streak at the newest contiguous run', async () => {
    const { m } = await makeFixture();
    addFinalizedPass(m.id, 1000, 'debounced');
    addFinalizedPass(m.id, 2000, 'conducted'); // breaks the run
    addFinalizedPass(m.id, 3000, 'debounced'); // newest
    const r = await buildMissionDiagnostic(project, m.id, { ...NO_GIT, now: () => 4000 });
    expect(r.conductorPass.debouncedStreak).toBe(1);
    expect(r.conductorPass.lastOutcome).toBe('debounced');
  });

  test('an open (unfinalized) newest row reads isInflight and is excluded from the streak', async () => {
    const { m } = await makeFixture();
    addFinalizedPass(m.id, 1000, 'debounced');
    addFinalizedPass(m.id, 2000, 'debounced');
    openPassRow(project, m.id, 3000); // open, newest — endedAt stays null
    const r = await buildMissionDiagnostic(project, m.id, { ...NO_GIT, now: () => 5000 });
    expect(r.conductorPass.isInflight).toBe(true);
    expect(r.conductorPass.debouncedStreak).toBe(2);
    expect(r.conductorPass.lastPassAt).toBe(2000); // the open row is excluded
  });

  test('no passes yield the all-null/zero shape, not inflight', async () => {
    const { m } = await makeFixture();
    const r = await buildMissionDiagnostic(project, m.id, NO_GIT);
    expect(r.conductorPass).toEqual({
      lastPassAt: null, lastArm: null, lastOutcome: null, ran: null,
      isInflight: false, debouncedStreak: 0, staleSeconds: null,
    });
  });
});

describe('buildMissionDiagnostic baseHealth', () => {
  test('a base-repair epic with an in_progress child leaf surfaces as repairLeafInflight', async () => {
    const { m } = await makeFixture();
    const repairEpic = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: '[EPIC] base-repair', kind: 'epic',
      status: 'ready', baseRepair: 1,
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1', title: 'green the tsc lane', kind: 'leaf',
      parentId: repairEpic.id, status: 'ready',
    });
    const claimed = await claimTodo(project, leaf.id, 'agent-1', 60_000);
    expect(claimed).not.toBeNull();
    const r = await buildMissionDiagnostic(project, m.id, NO_GIT);
    expect(r.baseHealth.repairLeafInflight?.id).toBe(leaf.id);
    expect(r.baseHealth.repairLeafInflight?.title).toBe('green the tsc lane');
  });

  test('a base-repair epic with no in-flight child leaf yields repairLeafInflight null', async () => {
    const { m } = await makeFixture();
    const repairEpic = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: '[EPIC] base-repair', kind: 'epic',
      status: 'ready', baseRepair: 1,
    });
    await createTodo(project, {
      ownerSession: 's1', title: 'not started', kind: 'leaf',
      parentId: repairEpic.id, status: 'ready',
    }); // ready, never claimed ⇒ not in_progress
    const r = await buildMissionDiagnostic(project, m.id, NO_GIT);
    expect(r.baseHealth.repairLeafInflight).toBeNull();
  });

  test('no base-gate row (epicHeadSha resolves null) yields tsc/suite unknown and still resolves', async () => {
    const { m } = await makeFixture();
    const r = await buildMissionDiagnostic(project, m.id, {
      isEpicLandedInGit: async () => 'indeterminate', epicHeadSha: async () => null,
    });
    expect(r.baseHealth.tsc).toBe('unknown');
    expect(r.baseHealth.suite).toBe('unknown');
  });

  test('hostLoad.saturated is true when load average exceeds the CPU-scaled threshold', async () => {
    const { m } = await makeFixture();
    const r = await buildMissionDiagnostic(project, m.id, {
      ...NO_GIT,
      readMachineLoad: () => ({ loadAvg: [8, 8, 8], cpuCount: 2 }),
    });
    expect(r.hostLoad.saturated).toBe(true);
    expect(r.hostLoad.loadAvg1).toBe(8);
    expect(r.hostLoad.cpuCount).toBe(2);
    // Verify status and baseHealth still populated.
    expect(r.status).not.toBeNull();
    expect(r.baseHealth).not.toBeNull();
  });

  test('hostLoad.saturated is false when load average is under the CPU-scaled threshold', async () => {
    const { m } = await makeFixture();
    const r = await buildMissionDiagnostic(project, m.id, {
      ...NO_GIT,
      readMachineLoad: () => ({ loadAvg: [1, 1, 1], cpuCount: 8 }),
    });
    expect(r.hostLoad.saturated).toBe(false);
    expect(r.hostLoad.loadAvg1).toBe(1);
    expect(r.hostLoad.cpuCount).toBe(8);
  });

  test('hostLoad.saturated is null when readMachineLoad throws, while status/rollup/baseHealth stay populated', async () => {
    const { m } = await makeFixture();
    const r = await buildMissionDiagnostic(project, m.id, {
      ...NO_GIT,
      readMachineLoad: () => { throw new Error('boom'); },
    });
    expect(r.hostLoad.saturated).toBeNull();
    expect(r.hostLoad.loadAvg1).toBeNull();
    expect(r.hostLoad.cpuCount).toBeNull();
    // Verify status, rollup, and baseHealth still populated.
    expect(r.status).not.toBeNull();
    expect(r.rollup).not.toBeNull();
    expect(r.baseHealth).not.toBeNull();
  });
});

describe('buildMissionDiagnostic read-only + fail-open (crit 7)', () => {
  test('a call performs no write to the todos db (row count unchanged)', async () => {
    const { m } = await makeFixture();
    const { listTodos } = await import('../todo-store');
    const before = listTodos(project, { includeCompleted: true }).length;
    await buildMissionDiagnostic(project, m.id, NO_GIT);
    await buildMissionDiagnostic(project, m.id, NO_GIT);
    const after = listTodos(project, { includeCompleted: true }).length;
    expect(after).toBe(before);
  });

  test('every injected source throwing still resolves to a well-formed all-degraded object', async () => {
    const { m, e } = await makeFixture();
    const boom = () => { throw new Error('boom'); };
    const r = await buildMissionDiagnostic(project, m.id, {
      isEpicLandedInGit: async () => { boom(); return 'landed'; },
      epicHeadSha: async () => { boom(); return null; },
      now: () => { boom(); return 0; },
    });
    // Shape intact, every git-fed field degraded — never a rejection.
    expect(Object.keys(r).sort()).toEqual(
      ['baseHealth', 'conductorPass', 'criteria', 'hostLoad', 'leaves', 'rollup', 'status'].sort(),
    );
    const servingEpic = r.criteria[0]?.servingEpics.find((s) => s.id === e.id);
    expect(servingEpic?.landedInGit).toBeNull(); // throwing probe ⇒ indeterminate ⇒ null
    expect(r.baseHealth.tsc).toBe('unknown');
    expect(r.baseHealth.suite).toBe('unknown');
    // now() throwing is caught inside the conductorPass block ⇒ all-degraded shape
    expect(r.conductorPass.staleSeconds).toBeNull();
  });
});

function makeRun(reason: string | null): LeafRunSummary {
  return {
    leafId: 'leaf1',
    project: 'p',
    epicId: 'epic1',
    finalOutcome: 'rejected',
    reviewVerdict: null,
    reason,
    pathTaken: null,
    tier: null,
    lastTs: 0,
    nodesSpent: 0,
    attempts: 0,
    costUsd: 0,
  };
}

describe('classifyLeafTerminal', () => {
  test('a leaf rejected on epic-base-red classifies as epic-base-red, not gate-rejected', () => {
    const todo = { acceptanceStatus: 'rejected' } as const;
    const run = makeRun('epic-base-red: npx tsc --noEmit');
    const result = classifyLeafTerminal(todo, run, 'blocked');
    expect(result).toBe('epic-base-red');
    expect(result).not.toBe('gate-rejected');
  });

  test('a leaf rejected on its own gate failure classifies as gate-rejected', () => {
    const todo = { acceptanceStatus: 'rejected' } as const;
    const run = makeRun('review: missing test coverage for X');
    expect(classifyLeafTerminal(todo, run, 'blocked')).toBe('gate-rejected');
  });

  test('a non-terminal leaf whose CANONICAL derived status is blocked classifies as blocked-dependency', () => {
    // Uses the canonical derivedStatus label, never the shadow enum (status-oracle S6).
    const todo = { acceptanceStatus: null } as const;
    expect(classifyLeafTerminal(todo, null, 'blocked')).toBe('blocked-dependency');
  });

  test('a non-terminal leaf that is ready/planned (not blocked) with no settled run classifies as inflight', () => {
    const todo = { acceptanceStatus: null } as const;
    expect(classifyLeafTerminal(todo, null, 'ready')).toBe('inflight');
  });
});
