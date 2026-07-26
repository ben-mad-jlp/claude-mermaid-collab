// Panel enforcement for high-stakes criterion verification. When a criterion is
// reopened by land, contested by humans, or approaching serve limits, an independent
// panel of three lenses must reach strict-majority verdict to approve met=true.
// This test drives the live handler and store to verify the panel gating logic.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMissionTool } from '../mission-tools';
import { createTodo, _closeProject } from '../../services/todo-store';
import { addCriterion, listCriteria, enqueueRecheck } from '../../services/mission-store';
import { createEscalation, _closeDb } from '../../services/supervisor-store';

let project: string;
const S = 's_test';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-verify-panel-'));
  // Isolate supervisor.db by using the project dir.
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function callMissionTool(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleMissionTool(name, { project, ...args });
  return JSON.parse(out!);
}

describe('criterion verify-panel enforcement', () => {
  test('(a) no-trigger single verdict — records met=true', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Panel test case (a)',
      kind: 'mission',
    });

    const criterion = addCriterion(project, mission.id, 'Test criterion (no reopens, no contests)');

    // No reopens, no pending rechecks, no contested cards — no panel triggered.
    // Single verdict calls the normal path.
    const result = await callMissionTool('set_mission_criterion', {
      criterionId: criterion.id,
      met: true,
      evidence: 'Simple single verdict',
      verifiedBy: 'test-checker',
      verifiedAtSha: 'abc1234',
      evidencePaths: ['src/test.ts'],
    });

    expect(result.criterionId).toBe(criterion.id);
    expect(result.met).toBe(true);
    expect(result.evidence).toBe('Simple single verdict');
    expect(result.panel).toBe(false);
    expect(result.trigger).toBeNull();

    // Verify it was recorded in the store.
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(true);
    expect(stored?.evidence).toBe('Simple single verdict');
  });

  test('(b) reopened-by-land trigger — throws without ≥2 panelVerdicts, met stays false', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Panel test case (b)',
      kind: 'mission',
    });

    const criterion = addCriterion(project, mission.id, 'Test criterion (reopened)');

    // Enqueue a recheck with land-diff-intersects-evidence → reopened-by-land trigger.
    enqueueRecheck(project, {
      criterionId: criterion.id,
      todoId: mission.id,
      reason: 'land-diff-intersects-evidence',
    });

    // Attempt met=true without panel verdicts → should throw.
    expect(
      callMissionTool('set_mission_criterion', {
        criterionId: criterion.id,
        met: true,
        evidence: 'Single verdict (insufficient)',
        verifiedBy: 'test-checker',
        verifiedAtSha: 'abc1234',
      }),
    ).rejects.toThrow(/reopened-by-land/);

    // Verify met was NOT updated (stays false).
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(false);
  });

  test('(b) contested-card trigger — throws without ≥2 panelVerdicts, met stays false', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Panel test case (b) contested',
      kind: 'mission',
    });

    const criterion = addCriterion(project, mission.id, 'Test criterion (contested)');

    // Create a contested card (decision kind) linked to the criterion.
    createEscalation({
      project,
      session: S,
      kind: 'decision',
      questionText: 'Is the criterion still valid?',
      todoId: criterion.id,
      conditionKey: `decision:${criterion.id}`,
      conditionTuple: [criterion.id],
    });

    // Attempt met=true without panel verdicts → should throw.
    expect(
      callMissionTool('set_mission_criterion', {
        criterionId: criterion.id,
        met: true,
        evidence: 'Single verdict (insufficient)',
        verifiedBy: 'test-checker',
        verifiedAtSha: 'abc1234',
      }),
    ).rejects.toThrow(/contested-card/);

    // Verify met was NOT updated (stays false).
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(false);
  });


  test('(c) 2-met/1-not-met panel — records met=true', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Panel test case (c)',
      kind: 'mission',
    });

    const criterion = addCriterion(project, mission.id, 'Test criterion (contested)');

    // Create a contested card to trigger the panel.
    createEscalation({
      project,
      session: S,
      kind: 'decision',
      questionText: 'Is the criterion still valid?',
      todoId: criterion.id,
      conditionKey: `decision:${criterion.id}`,
      conditionTuple: [criterion.id],
    });

    // Provide 3 verdicts: 2 met, 1 not-met → strict majority = met.
    const result = await callMissionTool('set_mission_criterion', {
      criterionId: criterion.id,
      met: true,
      evidence: 'Panel approval',
      verifiedBy: 'panel-conductor',
      verifiedAtSha: 'abc1234',
      panelVerdicts: [
        { lens: 'evidence-exists', met: true, reason: 'Files checked and citations found' },
        { lens: 'regression-red-when-neutered', met: true, reason: 'Test goes red without the fix' },
        { lens: 'holds-at-head', met: false, reason: 'Claim no longer holds at HEAD' },
      ],
    });

    expect(result.criterionId).toBe(criterion.id);
    expect(result.met).toBe(true);
    expect(result.panel).toBe(true);
    expect(result.trigger).toBe('contested-card');

    // Verify stored verdict has met=true.
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(true);
    expect(stored?.evidence).toBe('Panel approval');
  });

  test('(d) 1-met/2-not-met panel — records met=false with dissent in evidence', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] Panel test case (d)',
      kind: 'mission',
    });

    const criterion = addCriterion(project, mission.id, 'Test criterion (high serve)');

    // Create a contested card to trigger the panel.
    createEscalation({
      project,
      session: S,
      kind: 'blocker',
      questionText: 'This criterion needs human review',
      todoId: criterion.id,
      conditionKey: `blocker:${criterion.id}`,
      conditionTuple: [criterion.id],
    });

    // Provide 3 verdicts: 1 met, 2 not-met → minority met = not met, with dissent.
    const result = await callMissionTool('set_mission_criterion', {
      criterionId: criterion.id,
      met: true,
      evidence: 'Base evidence',
      verifiedBy: 'panel-conductor',
      verifiedAtSha: 'abc1234',
      panelVerdicts: [
        { lens: 'evidence-exists', met: true, reason: 'Files exist' },
        { lens: 'regression-red-when-neutered', met: false, reason: 'Test stays green without the fix' },
        { lens: 'holds-at-head', met: false, reason: 'Claim does not hold at HEAD' },
      ],
    });

    expect(result.criterionId).toBe(criterion.id);
    expect(result.met).toBe(false);
    expect(result.panel).toBe(true);
    expect(result.trigger).toBe('contested-card');

    // Verify stored verdict has met=false with dissent appended.
    const stored = listCriteria(project, mission.id).find((c) => c.id === criterion.id);
    expect(stored?.met).toBe(false);
    expect(stored?.evidence).toContain('Base evidence');
    expect(stored?.evidence).toContain('PANEL DISSENT');
    expect(stored?.evidence).toContain('contested-card');
    expect(stored?.evidence).toContain('regression-red-when-neutered: Test stays green without the fix');
    expect(stored?.evidence).toContain('holds-at-head: Claim does not hold at HEAD');
  });
});
