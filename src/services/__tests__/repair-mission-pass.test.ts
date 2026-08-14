import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  _closeProject,
} from '../todo-store';
import { ensureBucket } from '../bucket-registry';
import { listMissions, listCriteria, isMissionTerminal } from '../mission-store';
import { runRepairForgePass, REPAIR_MISSION_APPROVAL_KIND, REPAIR_FORGE_INTERVAL_MS, _resetRepairForgeThrottle } from '../repair-mission-pass';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { recordAutoAction } from '../auto-action-audit';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'repair-mission-pass-'));
  mkdirSync(join(dir, '.collab'), { recursive: true });
  return dir;
}

const projects: string[] = [];
afterEach(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    rmSync(p, { recursive: true, force: true });
  }
});

describe('repair-mission-pass', () => {
  test('six open bugfix requests forge one unapproved mission, consume all six, and raise exactly one approval card', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed six bugfix leaves
    const leafIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds.push(leaf.id);
    }

    // Record escalations that would be created (don't call the real one — throws on tmp paths)
    const createdEscalations: any[] = [];

    // Run the pass with threshold: 6 to batch all 6
    const result = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: (input) => {
        createdEscalations.push(input);
        return {
          escalation: {
            id: 'esc-' + Math.random(),
            project,
            session: input.session,
            kind: input.kind,
            questionText: input.questionText,
            status: 'open',
            createdAt: Date.now(),
            resolvedAt: null,
            serverId: '',
            todoId: input.todoId ?? null,
            options: input.options ?? [],
            recommended: null,
            ui: null,
            operatorGated: input.operatorGated ? 1 : 0,
            audience: input.audience ?? 'human',
            proof: null,
            stewardAttempts: 0,
            suggestedAction: null,
            triageInFlight: false,
            resolvedBy: null,
            briefingMd: null,
            briefingModel: null,
            briefingAt: null,
            conditionKey: input.conditionKey ?? null,
            conditionHash: null,
            lastSeenAt: Date.now(),
            recurrenceCount: 0,
            resolutionNote: null,
            expiresAt: null,
          },
          isNew: true,
        };
      },
    });

    // Assertions: forged != null, reason === 'forged'
    expect(result.reason).toBe('forged');
    expect(result.forged).not.toBeNull();
    expect(result.forged!.missionId).toBeTruthy();
    expect(result.forged!.criteriaCount).toBe(6);
    expect(result.forged!.consumed.length).toBe(6);

    const missionId = result.forged!.missionId;

    // Verify mission is unapproved
    const missions = listMissions(project);
    const repairMission = missions.find((m) => m.node.id === missionId);
    expect(repairMission).toBeTruthy();
    expect(repairMission!.mission.status).toBe('unapproved');

    // Verify all 6 leaves are done + promotedTo the mission
    for (const leafId of leafIds) {
      const leaf = getTodo(project, leafId)!;
      expect(leaf.status).toBe('done');
      expect(leaf.promotedTo).toBe(missionId);
    }

    // Verify exactly one escalation was created
    expect(createdEscalations.length).toBe(1);
    const esc = createdEscalations[0];
    expect(esc.kind).toBe(REPAIR_MISSION_APPROVAL_KIND);
    expect(esc.audience).toBe('human');
    expect(esc.operatorGated).toBe(true);
    expect(esc.todoId).toBe(missionId);
    expect(esc.conditionKey).toBe(`repair-forge:${missionId}`);
  });

  test('a second pass while a repair mission is open forges nothing and returns repair-mission-open', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed six more bugfix leaves
    for (let i = 0; i < 6; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
    }

    // Run the pass once to forge a mission
    const result1 = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
    });

    expect(result1.reason).toBe('forged');
    const missionId = result1.forged!.missionId;

    // Seed six MORE open requests
    for (let i = 6; i < 12; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
    }

    // Run a second pass — should refuse because repair mission is open
    const result2 = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
    });

    expect(result2.reason).toBe('repair-mission-open');
    expect(result2.forged).toBeNull();

    // Verify the new todos are still open (not consumed)
    const missions = listMissions(project);
    const repairMission = missions.find((m) => m.node.id === missionId);
    expect(repairMission).toBeTruthy();
    expect(!isMissionTerminal(repairMission!.mission)).toBe(true);
  });

  test('forged criteria equal the request fixedMeans strings verbatim', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 6 bugfix leaves with specific fixedMeans
    const fixedMeansArray = [
      'First criterion text',
      'Second criterion text',
      'Third criterion text',
      'Fourth criterion text',
      'Fifth criterion text',
      'Sixth criterion text',
    ];

    for (let i = 0; i < 6; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: fixedMeansArray[i],
        },
      });
    }

    // Run the pass
    const result = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
    });

    expect(result.forged).not.toBeNull();
    const missionId = result.forged!.missionId;

    // Re-read mission criteria and verify they match fixedMeans verbatim
    const criteria = listCriteria(project, missionId);
    expect(criteria.length).toBe(6);

    // Verify all 6 criteria texts are present (order may vary due to UUID sorting in batch selection)
    const criteriaTexts = criteria.map(c => c.text).sort();
    const expectedTexts = fixedMeansArray.sort();
    for (let i = 0; i < 6; i++) {
      expect(criteriaTexts[i]).toBe(expectedTexts[i]);
    }
  });

  test('size trigger names size on the card and in the mission-forge performed audit reason', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 6 fresh bugfix leaves (not aged, so size will trigger)
    for (let i = 0; i < 6; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
    }

    // Record escalations and audit rows
    const createdEscalations: any[] = [];
    const auditRows: any[] = [];
    const now = Date.now();

    // Run with threshold: 6 to trigger by size
    const result = await runRepairForgePass(project, {
      threshold: 6,
      ageMs: 72 * 60 * 60 * 1000,
      now,
      forge: forgeMission,
      createEscalation: (input) => {
        createdEscalations.push(input);
        return { escalation: {} as any, isNew: true };
      },
      recordAutoAction: (input) => {
        auditRows.push(input);
      },
    });

    expect(result.reason).toBe('forged');

    // Assert the card text contains 'triggered by size'
    expect(createdEscalations.length).toBe(1);
    const cardText = createdEscalations[0].questionText;
    expect(cardText).toContain('triggered by size');
    expect(cardText).toContain('6 >= k=6');
    expect(cardText).not.toContain('triggered by age');
    expect(cardText).not.toContain('age');

    // Assert exactly one performed audit row with trigger=size
    const performedRows = auditRows.filter((r) => r.action === 'mission-forge' && r.outcome === 'performed');
    expect(performedRows.length).toBe(1);
    const performedReason = performedRows[0].reason;
    expect(performedReason).toContain('trigger=size');
    expect(performedReason).not.toContain('trigger=age');
  });

  test('age trigger names age on the card and in the mission-forge performed audit reason', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 2 fresh bugfix leaves
    for (let i = 0; i < 2; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
    }

    // Record escalations and audit rows
    const createdEscalations: any[] = [];
    const auditRows: any[] = [];

    // Set `now` to be 2.5 hours in the future (relative to when the todos were created just now)
    // so that even fresh todos will appear old relative to this injected time.
    const ageMs = 2 * 3600 * 1000; // 2 hours
    const baseNow = Date.now();
    const now = baseNow + ageMs + 1000; // 2 hours + 1 second in the future

    // Run with threshold: 5 (less than 2, so age will trigger)
    const result = await runRepairForgePass(project, {
      threshold: 5,
      ageMs,
      now,
      forge: forgeMission,
      createEscalation: (input) => {
        createdEscalations.push(input);
        return { escalation: {} as any, isNew: true };
      },
      recordAutoAction: (input) => {
        auditRows.push(input);
      },
    });

    expect(result.reason).toBe('forged');

    // Assert the card text contains 'triggered by age'
    expect(createdEscalations.length).toBe(1);
    const cardText = createdEscalations[0].questionText;
    expect(cardText).toContain('triggered by age');
    expect(cardText).toContain('oldest');

    // Assert exactly one performed audit row with trigger=age
    const performedRows = auditRows.filter((r) => r.action === 'mission-forge' && r.outcome === 'performed');
    expect(performedRows.length).toBe(1);
    const performedReason = performedRows[0].reason;
    expect(performedReason).toContain('trigger=age');
    expect(performedReason).not.toContain('trigger=size');
  });

  test('a repair mission already open records exactly one capped mission-forge audit row', async () => {
    const project = freshProject();
    projects.push(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed six bugfix leaves for the first pass
    for (let i = 0; i < 6; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
    }

    // Record audit rows across both passes
    const allAuditRows: any[] = [];

    // First pass: forge a mission
    _resetRepairForgeThrottle(project);
    const result1 = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
      recordAutoAction: (input) => {
        allAuditRows.push(input);
      },
    });

    expect(result1.reason).toBe('forged');
    const missionId = result1.forged!.missionId;

    // Seed six more bugfix leaves for the second pass
    for (let i = 6; i < 12; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
    }

    // Second pass: should be capped because the repair mission is still open
    _resetRepairForgeThrottle(project);
    const result2 = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
      recordAutoAction: (input) => {
        allAuditRows.push(input);
      },
    });

    expect(result2.reason).toBe('repair-mission-open');
    expect(result2.forged).toBeNull();

    // Assert exactly one capped audit row with repair-mission-open reason
    const cappedRows = allAuditRows.filter((r) => r.action === 'mission-forge' && r.outcome === 'capped');
    expect(cappedRows.length).toBe(1);
    const cappedReason = cappedRows[0].reason;
    expect(cappedReason).toContain('repair-mission-open');
    expect(cappedReason).toContain(`mission ${missionId} is still open`);
  });
});
