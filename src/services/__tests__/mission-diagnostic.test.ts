import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject } from '../todo-store';
import { upsertMission, addCriterion } from '../mission-store';
import { buildMissionDiagnostic, classifyLeafTerminal } from '../mission-diagnostic';
import type { LeafRunSummary } from '../ledger-stats';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-diagnostic-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
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
      ['baseHealth', 'conductorPass', 'criteria', 'leaves', 'rollup', 'status'].sort(),
    );
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
    const todo = { acceptanceStatus: 'rejected', status: 'blocked' } as const;
    const run = makeRun('epic-base-red: npx tsc --noEmit');
    const result = classifyLeafTerminal(todo, run);
    expect(result).toBe('epic-base-red');
    expect(result).not.toBe('gate-rejected');
  });

  test('a leaf rejected on its own gate failure classifies as gate-rejected', () => {
    const todo = { acceptanceStatus: 'rejected', status: 'blocked' } as const;
    const run = makeRun('review: missing test coverage for X');
    expect(classifyLeafTerminal(todo, run)).toBe('gate-rejected');
  });
});
