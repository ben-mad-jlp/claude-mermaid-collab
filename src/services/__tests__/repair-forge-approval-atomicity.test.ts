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
import { listMissions, isMissionTerminal, getMission } from '../mission-store';
import {
  runRepairForgePass,
  REPAIR_MISSION_APPROVAL_KIND,
  REPAIR_APPROVAL_STALE_MS,
  _resetRepairForgeThrottle,
} from '../repair-mission-pass';
import { forgeMission } from '../../mcp/tools/mission-forge';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'repair-forge-approval-'));
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

describe('repair-forge-approval-atomicity', () => {
  test('leaves exactly one open escalation naming a mission it stamped awaitingApprovalSince', async () => {
    const project = freshProject();
    projects.push(project);
    _resetRepairForgeThrottle(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed six bugfix leaves
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

    // Record escalations that would be created
    const createdEscalations: any[] = [];
    const now = Date.now();

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
            createdAt: now,
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
            lastSeenAt: now,
            recurrenceCount: 0,
            resolutionNote: null,
            expiresAt: null,
          },
          isNew: true,
        };
      },
      now,
    });

    // Assertions
    expect(result.reason).toBe('forged');
    expect(result.forged).not.toBeNull();
    const missionId = result.forged!.missionId;

    // Mission must have awaitingApprovalSince set
    const mission = getMission(project, missionId);
    expect(mission).toBeTruthy();
    expect(mission!.awaitingApprovalSince).not.toBeNull();

    // Exactly one escalation created
    expect(createdEscalations.length).toBe(1);
    const esc = createdEscalations[0];
    expect(esc.kind).toBe(REPAIR_MISSION_APPROVAL_KIND);
    expect(esc.todoId).toBe(missionId);
    expect(esc.conditionKey).toBe(`repair-forge:${missionId}`);
  });

  test('writes zero mission rows when escalation creation throws', async () => {
    const project = freshProject();
    projects.push(project);
    _resetRepairForgeThrottle(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed six bugfix leaves
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

    const now = Date.now();
    const preCallMissions = listMissions(project).filter((m) => !isMissionTerminal(m.mission));

    // Run the pass with injected createEscalation that throws
    const result = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: () => {
        throw new Error('Injection: card creation failed');
      },
      now,
    });

    // Assertions: forged is null and reason is 'forge-rolled-back'
    expect(result.forged).toBeNull();
    expect(result.reason).toBe('forge-rolled-back');

    // No new non-terminal missions
    const postCallMissions = listMissions(project).filter((m) => !isMissionTerminal(m.mission));
    expect(postCallMissions.length).toBe(preCallMissions.length);
  });

  test('raises one card for a mission awaiting approval past the threshold', async () => {
    const project = freshProject();
    projects.push(project);
    _resetRepairForgeThrottle(project);

    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed six bugfix leaves for first forge
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

    const now = Date.now();
    const recordedEscalations: any[] = [];

    // First pass: forge the mission
    const result1 = await runRepairForgePass(project, {
      threshold: 6,
      forge: forgeMission,
      createEscalation: (input) => {
        recordedEscalations.push({ ...input, createdAt: now });
        return {
          escalation: {
            id: 'esc-' + Math.random(),
            project,
            session: input.session,
            kind: input.kind,
            questionText: input.questionText,
            status: 'open',
            createdAt: now,
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
            lastSeenAt: now,
            recurrenceCount: 0,
            resolutionNote: null,
            expiresAt: null,
          },
          isNew: true,
        };
      },
      listOpenEscalations: () => recordedEscalations.map((e) => ({
        ...e,
        id: e.conditionKey,
        status: 'open',
        resolvedAt: null,
        serverId: '',
      })),
      now,
    });

    expect(result1.reason).toBe('forged');
    expect(result1.forged).not.toBeNull();
    const missionId = result1.forged!.missionId;

    // Clear the throttle so we can run again immediately
    _resetRepairForgeThrottle(project);

    // Second pass: run with time advanced past stale threshold
    // This should detect the unapproved mission and raise a stale card
    const staleTime = now + REPAIR_APPROVAL_STALE_MS + 1000;
    const result2 = await runRepairForgePass(project, {
      threshold: 6, // No batch triggers (all 6 already consumed)
      forge: forgeMission,
      createEscalation: (input) => {
        recordedEscalations.push({ ...input, createdAt: staleTime });
        return {
          escalation: {
            id: 'esc-' + Math.random(),
            project,
            session: input.session,
            kind: input.kind,
            questionText: input.questionText,
            status: 'open',
            createdAt: staleTime,
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
            lastSeenAt: staleTime,
            recurrenceCount: 0,
            resolutionNote: null,
            expiresAt: null,
          },
          isNew: true,
        };
      },
      listOpenEscalations: () => recordedEscalations.map((e) => ({
        ...e,
        id: e.conditionKey,
        status: 'open',
        resolvedAt: null,
        serverId: '',
      })),
      now: staleTime,
    });

    // Second pass should NOT raise a new stale card (already has one from STEP 5)
    expect(result2.staleApprovalCards).toBe(0);

    // Check that exactly one escalation for this mission exists (deduped)
    const missionEscalations = recordedEscalations.filter(
      (e) => e.todoId === missionId || e.conditionKey === `repair-forge:${missionId}`,
    );
    expect(missionEscalations.length).toBe(1); // Only the one from STEP 5
    expect(missionEscalations[0].conditionKey).toBe(`repair-forge:${missionId}`);
  });
});
