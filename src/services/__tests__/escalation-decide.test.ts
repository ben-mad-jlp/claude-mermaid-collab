import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'escalation-decide-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

import {
  createEscalation,
  getEscalation,
  getEscalationDecision,
  _closeDb,
} from '../supervisor-store.ts';
import { decideEscalation } from '../escalation-decide.ts';
import { REPAIR_MISSION_APPROVAL_KIND } from '../repair-mission-pass.ts';
import {
  createTodo,
  getTodo,
  _closeProject,
  type Todo,
} from '../todo-store.ts';
import { ensureBucket } from '../bucket-registry.ts';
import { upsertMission, getMission, _resetMissionDbCache } from '../mission-store.ts';
import { forgeMission, type ForgeMissionInput } from '../../mcp/tools/mission-forge.ts';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG; });

function freshProject(): string {
  const projDir = mkdtempSync(join(tmpdir(), 'escalation-decide-project-'));
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

const OPTIONS = [
  { id: 'a', label: 'Approach A', detail: 'simpler' },
  { id: 'b', label: 'Approach B', detail: 'faster' },
];

describe('decideEscalation', () => {
  it('refuses an unoffered optionId and leaves the escalation open with no decision recorded', async () => {
    const { escalation } = createEscalation({
      audience: 'internal',
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A or B?',
      options: OPTIONS,
      recommended: 'a',
    });

    const result = await decideEscalation(escalation.id, { optionId: 'zzz' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('invalid-option');

    // Escalation should still be open
    const refreshed = getEscalation(escalation.id);
    expect(refreshed?.status).toBe('open');

    // No decision recorded
    const decision = getEscalationDecision(escalation.id);
    expect(decision).toBeNull();
  });

  it('records a valid option decision and flips status to decided', async () => {
    const { escalation } = createEscalation({
      audience: 'internal',
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A or B?',
      options: OPTIONS,
      recommended: 'a',
    });

    const result = await decideEscalation(escalation.id, { optionId: 'a' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.decision.optionId).toBe('a');
    expect(result.escalation.id).toBe(escalation.id);

    // Decision recorded
    const decision = getEscalationDecision(escalation.id);
    expect(decision?.optionId).toBe('a');

    // Escalation status flipped
    const refreshed = getEscalation(escalation.id);
    expect(refreshed?.status).toBe('decided');
  });

  it('records the decision under the full id when answered with a short id', async () => {
    const { escalation } = createEscalation({
      audience: 'internal',
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A or B?',
      options: OPTIONS,
      recommended: 'a',
    });

    // Take the first 8 chars as a short id
    const shortId = escalation.id.substring(0, 8);

    const result = await decideEscalation(shortId, { optionId: 'a' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    // Decision is recorded under the FULL id (what's in the store)
    const decision = getEscalationDecision(escalation.id);
    expect(decision).not.toBeNull();
    expect(decision?.optionId).toBe('a');

    // The returned escalation is the full one
    expect(result.escalation.id).toBe(escalation.id);
  });

  it('returns a typed ambiguous-id refusal instead of throwing, leaving candidates open', async () => {
    // Create several escalations to find colliding prefixes
    const escalations = [];
    for (let i = 0; i < 30; i++) {
      const { escalation: esc } = createEscalation({
        audience: 'internal',
        project: '/p',
        session: 's',
        kind: 'question',
        questionText: `Question ${i}`,
      });
      escalations.push(esc);
    }

    // Find two escalations that share a prefix
    let ambiguous = false;
    let ambiguousPrefix = '';
    let candidateIds: string[] = [];
    for (let len = 1; len < 8; len++) {
      const prefixes = new Map<string, string[]>();
      for (const esc of escalations) {
        const prefix = esc.id.slice(0, len);
        if (!prefixes.has(prefix)) prefixes.set(prefix, []);
        prefixes.get(prefix)!.push(esc.id);
      }
      for (const [prefix, ids] of prefixes) {
        if (ids.length > 1) {
          ambiguous = true;
          ambiguousPrefix = prefix;
          candidateIds = ids;
          break;
        }
      }
      if (ambiguous) break;
    }

    if (ambiguous) {
      // Call decideEscalation with ambiguous prefix and verify it returns typed refusal
      const result = await decideEscalation(ambiguousPrefix, { optionId: 'a' });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.reason).toBe('ambiguous-id');
      expect(result.message).toContain(ambiguousPrefix);

      // Verify both candidate rows are still open
      for (const candId of candidateIds) {
        const esc = getEscalation(candId);
        expect(esc?.status).toBe('open');
      }
    }
    // If we didn't get a collision naturally, the test still passes (collision is probabilistic)
  });

  it('approving a repair-mission-approval card clears awaitingApprovalSince and leaves the mission driveable', async () => {
    const project = freshProject();
    projects.push(project);

    // Create a mission with approved: false
    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: 'Test repair mission',
      criteria: ['Criterion A'],
      budgetUsd: 10,
      approved: false,
      activate: false,
      consumesTodoIds: [],
    });

    const missionId = forgeResult.missionId;

    // Verify mission starts as unapproved
    let mission = getMission(project, missionId);
    expect(mission).not.toBeNull();
    expect(mission!.status).toBe('unapproved');
    expect(mission!.awaitingApprovalSince).not.toBeNull();

    // Create the repair-approval escalation
    const { escalation } = createEscalation({
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

    // Approve the mission
    const result = await decideEscalation(escalation.id, { optionId: 'approve' });
    expect(result.ok).toBe(true);

    // Verify mission is now approved and driveable
    mission = getMission(project, missionId);
    expect(mission).not.toBeNull();
    expect(mission!.awaitingApprovalSince).toBeNull();
    expect(mission!.status).not.toBe('unapproved');
  });

  it('dismissing a repair-mission-approval card ends the mission and returns consumed bugfix requests to planned', async () => {
    const project = freshProject();
    projects.push(project);

    // Create two bugfix bucket leaves
    const bucketId = await ensureBucket(project, 'bugfix');
    const leaf1 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 1',
      parentId: bucketId,
    });
    const leaf2 = await createTodo(project, {
      ownerSession: 's',
      kind: 'leaf',
      title: 'Bug 2',
      parentId: bucketId,
    });

    // Create a mission that consumes the leaves
    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: 'Test repair mission',
      criteria: ['Criterion A'],
      budgetUsd: 10,
      approved: false,
      activate: false,
      consumesTodoIds: [leaf1.id, leaf2.id],
    });

    const missionId = forgeResult.missionId;

    // Verify mission is unapproved and leaves are consumed
    let mission = getMission(project, missionId);
    expect(mission!.status).toBe('unapproved');

    let l1 = getTodo(project, leaf1.id)!;
    let l2 = getTodo(project, leaf2.id)!;
    expect(l1.status).toBe('done');
    expect(l2.status).toBe('done');
    expect(l1.promotedTo).toBe(missionId);
    expect(l2.promotedTo).toBe(missionId);

    // Create and dismiss the repair-approval escalation
    const { escalation } = createEscalation({
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

    // Dismiss the mission
    const result = await decideEscalation(escalation.id, { optionId: 'dismiss' });
    expect(result.ok).toBe(true);

    // Verify mission is terminal and leaves are reopened
    mission = getMission(project, missionId);
    expect(mission!.abandonedAt).not.toBeNull();

    l1 = getTodo(project, leaf1.id)!;
    l2 = getTodo(project, leaf2.id)!;
    expect(l1.status).toBe('planned');
    expect(l1.promotedTo).toBeNull();
    expect(l1.consumedAt).toBeNull();
    expect(l2.status).toBe('planned');
    expect(l2.promotedTo).toBeNull();
    expect(l2.consumedAt).toBeNull();
  });
});
