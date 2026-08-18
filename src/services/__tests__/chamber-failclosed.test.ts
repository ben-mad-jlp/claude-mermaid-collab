// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  getCampaign,
  listChamberTranscript,
  listChamberDecisions,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import {
  CHAMBER_GENERALS,
  runChamber,
  type ChamberLLMFactory,
} from '../chamber';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'chamber-failclosed-'));
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

describe('chamber-failclosed', () => {
  test('a malformed president reply records the outcome inaction while the campaign row stays claimable', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify fail-closed decision',
    });

    // Snapshot the campaign before the run.
    const campaignBefore = getCampaign(project, campaign.id);
    expect(campaignBefore).toBeDefined();
    expect(campaignBefore!.droppedAt).toBeNull();

    const calls: string[] = [];
    let forgeCallCount = 0;

    // Stub factory that returns valid proposals/vetoes/wargame, but unparseable prose for decide.
    const stubFactory: ChamberLLMFactory = (role: string, phase: string) => ({
      complete: async (system: string, user: string) => {
        calls.push(`${role}:${phase}`);

        if (phase === 'propose') {
          return JSON.stringify({ goal: `goal-${role}`, rationale: `rationale-${role}` });
        } else if (phase === 'veto') {
          // 5 generals all pass (no veto).
          return JSON.stringify({ targetIndex: null, dissent: null });
        } else if (phase === 'wargame') {
          // All wargamers pass.
          return JSON.stringify({ critique: 'sound' });
        } else if (phase === 'decide') {
          // President returns unparseable prose (not JSON).
          return 'The decision is complex and cannot be reduced to numbers.';
        }
        return '';
      },
    });

    const forgeMissionSpy = async (proj: string, input: any) => {
      forgeCallCount++;
      return { id: 'forged-mission-id' };
    };

    // Run the chamber with the stubs.
    const result = await runChamber(project, {
      campaignId: campaign.id,
      sessionId: 'test-session',
      decidedAtSha: 'abc123',
      llm: stubFactory,
      model: 'test-model',
      forgeInput: { spec: 'test' },
    }, { forgeMission: forgeMissionSpy });

    // Assert the decision outcome is inaction.
    expect(result.decision.outcome).toBe('inaction');
    expect(result.decision.chosenCandidate).toBeNull();

    // Assert the chamber decision was recorded exactly once.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].outcome).toBe('inaction');
    expect(decisions[0].chosenCandidate).toBeNull();

    // Parse the decide transcript content to check the failure reason.
    const transcript = listChamberTranscript(project, campaign.id, 'test-session');
    const decideRow = transcript.find((t) => t.phase === 'decide');
    expect(decideRow).toBeDefined();
    const decideContent = JSON.parse(decideRow!.content);
    expect(decideContent.outcome).toBe('inaction');
    expect(decideContent.reason).toBe('unparseable JSON');

    // Assert forgeMission was never called.
    expect(forgeCallCount).toBe(0);
    expect(result.forged).toBeNull();

    // Assert the campaign row is still claimable (not dropped).
    const campaignAfter = getCampaign(project, campaign.id);
    expect(campaignAfter).toBeDefined();
    expect(campaignAfter!.droppedAt).toBeNull();
    expect(campaignAfter!.createdAt).toBe(campaignBefore!.createdAt);
  });

  test('transcript rows exist in the store before deps.forgeMission is first invoked', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify record-before-forge ordering',
    });

    let transcriptLengthObserved = 0;

    // Stub factory that returns valid proposals/vetoes/wargame/decide.
    const stubFactory: ChamberLLMFactory = (role: string, phase: string) => ({
      complete: async (system: string, user: string) => {
        if (phase === 'propose') {
          return JSON.stringify({ goal: `goal-${role}`, rationale: `rationale-${role}` });
        } else if (phase === 'veto') {
          return JSON.stringify({ targetIndex: null, dissent: null });
        } else if (phase === 'wargame') {
          return JSON.stringify({ critique: 'sound' });
        } else if (phase === 'decide') {
          return JSON.stringify({
            chosenIndex: 0,
            dissentIndex: null,
            guidance: 'Proceed with the first candidate.',
            reasoning: 'It is the most sound.',
          });
        }
        return '';
      },
    });

    const forgeMissionStub = async (proj: string, input: any) => {
      // Inside the forge stub, check that the transcript rows exist.
      const transcript = listChamberTranscript(project, campaign.id, 'test-session');
      transcriptLengthObserved = transcript.length;

      // The transcript should contain at least the propose/veto/wargame/decide rows.
      // We should see at least 4 (one per phase) but may see more depending on retries.
      if (transcriptLengthObserved === 0) {
        throw new Error('transcript was empty when forge was called');
      }

      return { id: 'forged-mission-id', transcriptLength: transcriptLengthObserved };
    };

    // Run the chamber with valid data to trigger a forge.
    const result = await runChamber(project, {
      campaignId: campaign.id,
      sessionId: 'test-session',
      decidedAtSha: 'abc123',
      llm: stubFactory,
      model: 'test-model',
      forgeInput: { spec: 'test' },
    }, { forgeMission: forgeMissionStub });

    // Assert the decision outcome is decision (successful).
    expect(result.decision.outcome).toBe('decision');
    expect(result.decision.chosenCandidate).toBe('goal-' + CHAMBER_GENERALS[0]);

    // Assert forgeMission was called and observed the transcript.
    expect(transcriptLengthObserved).toBeGreaterThan(0);

    // Assert the forged result reflects what the stub observed.
    expect(result.forged).toBeDefined();
    expect((result.forged as any).transcriptLength).toBe(transcriptLengthObserved);

    // Final check: the transcript rows still exist after the run.
    const finalTranscript = listChamberTranscript(project, campaign.id, 'test-session');
    expect(finalTranscript.length).toBeGreaterThan(0);
  });
});
