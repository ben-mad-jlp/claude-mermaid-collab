import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'card-condition-autoresolve-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

import { createEscalation, getEscalation, _closeDb } from '../supervisor-store.ts';
import { resolveVerifyOwedBackstopCards } from '../conductor-pass.ts';
import { resolveApprovedRepairMissionCards, REPAIR_MISSION_APPROVAL_KIND } from '../repair-mission-pass.ts';
import { VERIFY_OWED_BACKSTOP_KIND } from '../conductor-verify-owed-arm.ts';
import { verifyOwedConditionKey } from '../mission-stall-predicate.ts';
import { VERIFY_OWED_BACKSTOP_MS } from '../harness-caps.ts';
import { _closeProject, listTodos } from '../todo-store.ts';
import { _resetMissionDbCache, stampMissionNodeApproved } from '../mission-store.ts';
import { forgeMission } from '../../mcp/tools/mission-forge.ts';

beforeAll(() => { _closeDb(); });
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
});

function freshProject(): string {
  const projDir = mkdtempSync(join(tmpdir(), 'card-condition-autoresolve-project-'));
  mkdirSync(join(projDir, '.collab'), { recursive: true });
  return projDir;
}

const projects: string[] = [];
afterEach(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    _resetMissionDbCache(p);
    rmSync(p, { recursive: true, force: true });
  }
});

describe('card-condition-autoresolve', () => {
  it('resolves the verify-owed-backstop card and notes both criterion ids once nothing is owed', () => {
    const NOW = 1_800_000_000_000;
    const project = freshProject();
    projects.push(project);
    const missionId = 'mission-owed-cleared';

    const { escalation } = createEscalation({
      project,
      session: 'test-session',
      kind: VERIFY_OWED_BACKSTOP_KIND,
      todoId: missionId,
      audience: 'human',
      operatorGated: true,
      conditionKey: verifyOwedConditionKey(missionId, ['c1', 'c2']),
      conditionTuple: ['verify-owed', missionId, 'c1', 'c2'],
      questionText: 'Mission has criteria owed a verify',
    });

    const result = resolveVerifyOwedBackstopCards(project, missionId, {
      listCriteriaWithActions: () => [
        { id: 'c1', action: 'discover', servingEpicState: 'landed', servingEpicLandedAt: null, servingWorkCompletedAt: null, met: true, verifiedAt: NOW },
        { id: 'c2', action: 'discover', servingEpicState: 'landed', servingEpicLandedAt: null, servingWorkCompletedAt: null, met: true, verifiedAt: NOW },
      ] as any,
      now: () => NOW,
      thresholdMs: VERIFY_OWED_BACKSTOP_MS,
    });

    expect(result.resolved).toContain(escalation.id);

    const refreshed = getEscalation(escalation.id);
    expect(refreshed!.status).toBe('resolved');
    expect(refreshed!.resolutionNote ?? '').toContain('c1');
    expect(refreshed!.resolutionNote ?? '').toContain('c2');
  });

  it('resolves the repair-mission-approval card once the mission node is stamped approved', async () => {
    const project = freshProject();
    projects.push(project);

    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: 'Repair mission',
      criteria: ['Criterion A'],
      budgetUsd: 10,
      approved: false,
      activate: false,
      consumesTodoIds: [],
    });
    const missionId = forgeResult.missionId;

    const { escalation } = createEscalation({
      project,
      session: 'test-session',
      kind: REPAIR_MISSION_APPROVAL_KIND,
      todoId: missionId,
      audience: 'human',
      operatorGated: true,
      conditionKey: `repair-forge:${missionId}`,
      questionText: 'Approve this mission?',
    });

    stampMissionNodeApproved(project, missionId, 'test');

    const allTodos = listTodos(project);
    const node = allTodos.find((t) => t.id === missionId);
    expect(node?.approvedAt).not.toBeNull();

    const resolvedCount = resolveApprovedRepairMissionCards(project, { allTodos });
    expect(resolvedCount).toBeGreaterThanOrEqual(1);

    const refreshed = getEscalation(escalation.id);
    expect(refreshed!.status).toBe('resolved');
  });

  it('leaves the verify-owed-backstop card open while one criterion is still past the verify-owed threshold', () => {
    const NOW = 1_800_000_000_000;
    const project = freshProject();
    projects.push(project);
    const missionId = 'mission-still-owed';

    const { escalation } = createEscalation({
      project,
      session: 'test-session',
      kind: VERIFY_OWED_BACKSTOP_KIND,
      todoId: missionId,
      audience: 'human',
      operatorGated: true,
      conditionKey: verifyOwedConditionKey(missionId, ['c1', 'c2']),
      conditionTuple: ['verify-owed', missionId, 'c1', 'c2'],
      questionText: 'Mission has criteria owed a verify',
    });

    const result = resolveVerifyOwedBackstopCards(project, missionId, {
      listCriteriaWithActions: () => [
        { id: 'c1', action: 'discover', servingEpicState: 'landed', servingEpicLandedAt: null, servingWorkCompletedAt: null, met: true, verifiedAt: NOW },
        { id: 'c2', action: 'verify', servingEpicState: 'landed', servingEpicLandedAt: NOW - VERIFY_OWED_BACKSTOP_MS * 2, servingWorkCompletedAt: null, met: false, verifiedAt: null },
      ] as any,
      now: () => NOW,
      thresholdMs: VERIFY_OWED_BACKSTOP_MS,
    });

    expect(result.owed).toContain('c2');

    const refreshed = getEscalation(escalation.id);
    expect(refreshed!.status).toBe('open');
  });
});
