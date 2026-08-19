// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  addProbe,
  getCampaign,
  listCampaignCompletions,
  _resetCampaignDbCache,
  type ChamberDecisionRecord,
} from '../campaign-store';
import { runChamberCompletionArm, type ChamberJudgeDeps } from '../chamber-judge';
import { runCampaignPassForProject } from '../campaign-scheduling';
import { _closeProject } from '../todo-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import type { CampaignPassResult } from '../campaign-pass';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'chamber-judge-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('chamber-judge', () => {
  test('a scheduled completion convene stores a completion record for a goal-bearing campaign', async () => {
    // Create a campaign with a goal
    const campaign = createCampaign(project, { title: 'Test Campaign with Goal', goal: 'ship it' });
    const campaignId = campaign.id;

    // Track if recordCampaignCompletion was called
    let recordCompletionCalled = false;
    let recordedJudge = '';
    let recordedVerdict = '';

    // Stub the chamber with a decision outcome
    const mockRunChamber = async (_project: string, _args: any, _deps: any) => {
      return {
        candidates: [],
        vetoes: [],
        wargamed: [],
        decision: {
          id: 1,
          campaignId,
          sessionId: '__test_session__',
          outcome: 'decision' as const,
          chosenCandidate: 'Test',
          strongestDissent: null,
          refiningGuidance: 'Campaign is ready to close',
          decidedAtSha: 'a'.repeat(40),
          createdAt: Date.now(),
          frontFingerprint: null,
        },
        forged: null,
      };
    };

    // Mock recordCampaignCompletion to track calls
    const mockRecordCompletion = (_proj: string, input: any) => {
      recordCompletionCalled = true;
      recordedJudge = input.judge;
      recordedVerdict = input.verdict;
      // Return mock record
      return {
        id: 1,
        campaignId,
        judge: input.judge,
        verdict: input.verdict,
        ruledAtSha: input.ruledAtSha,
        rationale: input.rationale,
        ruledAt: Date.now(),
        artifactsRead: [],
        commandsRun: [],
        citedLenses: input.citedLenses ?? [],
      };
    };

    // Call the arm
    const result = await runChamberCompletionArm(project, campaignId, '__test_session__', {
      runChamber: mockRunChamber,
      recordCampaignCompletion: mockRecordCompletion,
      commitSha: () => 'a'.repeat(40),
    });

    // Assert that recordCampaignCompletion was called with the right judge
    expect(recordCompletionCalled).toBe(true);
    expect(recordedJudge).toBe('chamber');
    expect(recordedVerdict).toBe('done');
    expect(result.convened).toBe(true);
    expect(result.verdict).toBe('done');
  });

  test('a second convene while a chamber question card is open reuses the existing card', async () => {
    // Create a campaign with a goal
    const campaign = createCampaign(project, { title: 'Test Campaign', goal: 'test goal' });
    const campaignId = campaign.id;

    // Track escalation calls and open cards
    let escalationCallCount = 0;
    const openCards: Array<{ conditionKey: string | null }> = [];

    // Stub the chamber with an inaction outcome (which triggers card raising)
    const mockRunChamber = async () => {
      return {
        candidates: [],
        vetoes: [],
        wargamed: [],
        decision: {
          id: 1,
          campaignId,
          sessionId: '__test_session__',
          outcome: 'inaction' as const,
          chosenCandidate: null,
          strongestDissent: 'Insufficient evidence',
          refiningGuidance: null,
          decidedAtSha: 'b'.repeat(40),
          createdAt: Date.now(),
          frontFingerprint: null,
        },
        forged: null,
      };
    };

    // Mock that adds to openCards on create
    const mockListOpenEscalations = () => openCards;
    const mockCreateEscalation = (input: any) => {
      escalationCallCount++;
      openCards.push({ conditionKey: input.conditionKey ?? null });
      return {
        escalation: {
          id: 'test-escalation-id',
          project: input.project,
          session: input.session,
          kind: input.kind,
          questionText: input.questionText,
          status: 'open',
          createdAt: Date.now(),
          resolvedAt: null,
          serverId: '',
          todoId: null,
          options: null,
          recommended: null,
          ui: null,
          operatorGated: true,
          audience: 'human',
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
    };

    // First convene
    const firstResult = await runChamberCompletionArm(project, campaignId, '__test_session__', {
      runChamber: mockRunChamber,
      getCampaign: () => campaign,
      recordCampaignCompletion: () => ({ id: 1, campaignId, judge: 'chamber', verdict: 'not-done' as const, ruledAtSha: 'test', rationale: null, ruledAt: Date.now(), artifactsRead: [], commandsRun: [], citedLenses: [] }),
      listOpenEscalations: mockListOpenEscalations as any,
      createEscalation: mockCreateEscalation as any,
      commitSha: () => 'b'.repeat(40),
    });

    // Verify first convene raised a card
    expect(firstResult.raised).toBe(true);
    expect(escalationCallCount).toBe(1);

    // Second convene (should reuse the existing card)
    const secondResult = await runChamberCompletionArm(project, campaignId, '__test_session__', {
      runChamber: mockRunChamber,
      getCampaign: () => campaign,
      recordCampaignCompletion: () => ({ id: 2, campaignId, judge: 'chamber', verdict: 'not-done' as const, ruledAtSha: 'test', rationale: null, ruledAt: Date.now(), artifactsRead: [], commandsRun: [], citedLenses: [] }),
      listOpenEscalations: mockListOpenEscalations as any,
      createEscalation: mockCreateEscalation as any,
      commitSha: () => 'b'.repeat(40),
    });

    // Assert that raised === false on the second call
    expect(secondResult.raised).toBe(false);
    // Only one createEscalation call total (from the first convene)
    expect(escalationCallCount).toBe(1);
    // Only one card in openCards
    expect(openCards).toHaveLength(1);
  });
});
