import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'repair-approval-card-decision-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

import {
  createEscalation,
  _closeDb,
} from '../supervisor-store.ts';
import { normalizeEscalationStatus } from '../supervisor-store.ts';
import { repairApprovalDecisionFromStatus, applyCardKindResolution } from '../escalation-decide.ts';
import { REPAIR_MISSION_APPROVAL_KIND } from '../repair-mission-pass.ts';
import { _closeProject, getTodo } from '../todo-store.ts';
import { getMission, _resetMissionDbCache } from '../mission-store.ts';
import { forgeMission } from '../../mcp/tools/mission-forge.ts';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG; });

function freshProject(): string {
  const projDir = mkdtempSync(join(tmpdir(), 'repair-approval-card-decision-project-'));
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

describe('applyCardKindResolution via the bare escalation-resolve path', () => {
  it('1. approve decision on a repair-mission-approval card stamps the mission approvedAt and derives waiting', async () => {
    const project = freshProject();
    projects.push(project);

    // FIXTURE HAZARD: setMissionApproved only enqueues (derives 'waiting') when
    // another mission is already active in the project. Forge and activate a decoy
    // mission first, else the subject mission goes active and derives its active
    // status instead of 'waiting'.
    await forgeMission(project, {
      session: 'test-session',
      title: 'Decoy active mission',
      criteria: ['Decoy criterion'],
      approved: true,
      activate: true,
      consumesTodoIds: [],
    });

    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: 'Test repair mission',
      criteria: ['Criterion A'],
      approved: false,
      activate: false,
      consumesTodoIds: [],
    });
    const missionId = forgeResult.missionId;

    const { escalation: esc } = createEscalation({
      project,
      session: 'test-session',
      kind: REPAIR_MISSION_APPROVAL_KIND,
      audience: 'human',
      operatorGated: true,
      todoId: missionId,
      conditionKey: `repair-forge:${missionId}`,
      questionText: 'Approve this mission?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'dismiss', label: 'Dismiss' },
      ],
    });

    // Drive the exact expression the two bare-resolve call sites execute.
    const { status: canonical } = normalizeEscalationStatus('resolved');
    const decision = repairApprovalDecisionFromStatus(canonical);
    await applyCardKindResolution(esc, decision, esc.id);

    expect(getTodo(project, missionId)!.approvedAt).not.toBeNull();
    expect(getMission(project, missionId)!.status).toBe('waiting');
  });

  it('2. dismiss decision on a repair-mission-approval card stamps the mission closedAt', async () => {
    const project = freshProject();
    projects.push(project);

    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: 'Test repair mission',
      criteria: ['Criterion A'],
      approved: false,
      activate: false,
      consumesTodoIds: [],
    });
    const missionId = forgeResult.missionId;

    const { escalation: esc } = createEscalation({
      project,
      session: 'test-session',
      kind: REPAIR_MISSION_APPROVAL_KIND,
      audience: 'human',
      operatorGated: true,
      todoId: missionId,
      conditionKey: `repair-forge:${missionId}`,
      questionText: 'Approve this mission?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'dismiss', label: 'Dismiss' },
      ],
    });

    const { status: canonical } = normalizeEscalationStatus('stale');
    const decision = repairApprovalDecisionFromStatus(canonical);
    await applyCardKindResolution(esc, decision, esc.id);

    expect(getMission(project, missionId)!.closedAt).not.toBeNull();
  });

  it('3. a card of another kind carrying the same todoId leaves the mission status at unapproved', async () => {
    const project = freshProject();
    projects.push(project);

    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: 'Test repair mission',
      criteria: ['Criterion A'],
      approved: false,
      activate: false,
      consumesTodoIds: [],
    });
    const missionId = forgeResult.missionId;

    const { escalation: esc } = createEscalation({
      project,
      session: 'test-session',
      kind: 'decision',
      audience: 'internal',
      todoId: missionId,
      questionText: 'Unrelated decision card carrying the same todoId',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'dismiss', label: 'Dismiss' },
      ],
    });

    const { status: canonical } = normalizeEscalationStatus('resolved');
    const decision = repairApprovalDecisionFromStatus(canonical);
    await applyCardKindResolution(esc, decision, esc.id);

    expect(getMission(project, missionId)!.status).toBe('unapproved');
  });
});
