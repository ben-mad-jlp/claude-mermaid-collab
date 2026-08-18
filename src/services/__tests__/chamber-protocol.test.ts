// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
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
  propose,
  veto,
  wargame,
  decide,
  runChamber,
  type ChamberLLMFactory,
  type ChamberCandidate,
  type ChamberVeto,
} from '../chamber';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'chamber-protocol-'));
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

describe('chamber-protocol', () => {
  test('every general authors a candidate before any veto is recorded', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify chamber protocol',
    });

    const calls: string[] = [];

    // Stub factory that tracks calls and returns phase-specific replies.
    const stubFactory: ChamberLLMFactory = (role: string, phase: string) => ({
      complete: async () => {
        calls.push(`${phase}:${role}`);

        if (phase === 'propose') {
          return JSON.stringify({
            goal: `Close by improving ${role}`,
            rationale: `${role} believes this is the right closure goal`,
          });
        } else if (phase === 'veto') {
          return JSON.stringify({
            targetIndex: null,
            dissent: null,
          });
        } else if (phase === 'wargame') {
          return JSON.stringify({
            critique: `Critique from wargame round for ${role}`,
          });
        } else {
          return JSON.stringify({
            chosenIndex: 0,
            dissentIndex: null,
            guidance: 'Proceed with closure',
            reasoning: 'All evidence supports closure',
          });
        }
      },
    });

    const sessionId = 'session-test-1';

    // Run propose phase.
    const candidates = await propose(project, {
      campaignId: campaign.id,
      sessionId,
      decidedAtSha: 'abc1234',
      llm: stubFactory,
      model: 'test-model',
    });

    // Record the index of the last propose call.
    const lastProposeIndex = calls.findLastIndex((c) => c.startsWith('propose:'));
    expect(lastProposeIndex).toBeGreaterThanOrEqual(0);

    // All five generals should have proposed.
    expect(candidates.length).toBe(CHAMBER_GENERALS.length);
    const proposedGenerals = new Set(candidates.map((c) => c.general));
    for (const general of CHAMBER_GENERALS) {
      expect(proposedGenerals.has(general)).toBe(true);
    }

    // Now run the veto phase.
    const vetoes = await veto(project, {
      campaignId: campaign.id,
      sessionId,
      decidedAtSha: 'abc1234',
      llm: stubFactory,
      model: 'test-model',
    }, candidates);

    // Check that no veto call was made before all proposes completed.
    const firstVetoIndex = calls.findIndex((c) => c.startsWith('veto:'));
    if (firstVetoIndex >= 0) {
      expect(firstVetoIndex).toBeGreaterThan(lastProposeIndex);
    }

    // Check that the transcript has all five propose rows before any veto row.
    const transcript = listChamberTranscript(project, campaign.id, sessionId);
    const proposeRows = transcript.filter((t) => t.phase === 'propose');
    const vetoRows = transcript.filter((t) => t.phase === 'veto');

    expect(proposeRows.length).toBe(CHAMBER_GENERALS.length);

    // All propose rows should come before any veto row.
    if (vetoRows.length > 0) {
      const lastProposeRow = proposeRows[proposeRows.length - 1];
      const firstVetoRow = vetoRows[0];
      expect(lastProposeRow.id).toBeLessThan(firstVetoRow.id);
    }
  });

  test('a vetoed candidate is excluded from the wargame round', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Veto Test Campaign',
      goal: 'Verify veto filtering',
    });

    // Pre-define candidates.
    const testCandidates: ChamberCandidate[] = [
      { general: 'operations', goal: 'Verify operational readiness', rationale: 'Ops check' },
      { general: 'intelligence', goal: 'Verify data completeness', rationale: 'Intel check' },
      { general: 'comptroller', goal: 'Verify budget tracking', rationale: 'Budget check' },
      { general: 'counsel', goal: 'Verify scope clarity', rationale: 'Counsel check' },
      { general: 'inspector-general', goal: 'Verify record completeness', rationale: 'Record check' },
    ];

    const calls: string[] = [];

    // Stub factory: veto candidate 1 (operations), veto candidate 3 (counsel).
    const stubFactory: ChamberLLMFactory = (role: string, phase: string) => ({
      complete: async () => {
        calls.push(`${phase}:${role}`);

        if (phase === 'propose') {
          return JSON.stringify({
            goal: `Close by improving ${role}`,
            rationale: `${role} proposal`,
          });
        } else if (phase === 'veto') {
          // Veto candidate 1 if we're operations, or candidate 3 if we're counsel.
          if (role === 'operations') {
            return JSON.stringify({
              targetIndex: 1,
              dissent: 'Operations rejects intel closure',
            });
          } else if (role === 'counsel') {
            return JSON.stringify({
              targetIndex: 3,
              dissent: 'Counsel rejects scope closure',
            });
          }
          return JSON.stringify({
            targetIndex: null,
            dissent: null,
          });
        } else if (phase === 'wargame') {
          return JSON.stringify({
            critique: `Critique from ${role}`,
          });
        } else {
          return JSON.stringify({
            chosenIndex: 0,
            dissentIndex: null,
            guidance: 'Proceed',
            reasoning: 'Ready',
          });
        }
      },
    });

    const sessionId = 'session-test-2';

    // Run propose with our pre-defined candidates.
    const proposeArgs = {
      campaignId: campaign.id,
      sessionId,
      decidedAtSha: 'def5678',
      llm: stubFactory,
      model: 'test-model',
    };

    // Manually run propose to set up the candidates.
    const proposedCandidates = await propose(project, proposeArgs);
    expect(proposedCandidates.length).toBe(CHAMBER_GENERALS.length);

    // Run veto phase.
    const vetoes = await veto(project, proposeArgs, proposedCandidates);

    // Check that two vetoes were recorded.
    expect(vetoes.length).toBeGreaterThanOrEqual(2);
    const vetoedIndices = new Set(vetoes.map((v) => v.targetIndex));

    // Run wargame phase.
    const wargamed = await wargame(project, proposeArgs, proposedCandidates, vetoes);

    // Check that vetoed candidates are not in the wargame results.
    const wargamedGoals = new Set(wargamed.map((w) => w.candidate.goal));

    for (let i = 0; i < proposedCandidates.length; i++) {
      if (vetoedIndices.has(i)) {
        // This candidate was vetoed; it should NOT be in the wargame results.
        expect(wargamedGoals.has(proposedCandidates[i].goal)).toBe(false);
      } else {
        // This candidate was not vetoed; it SHOULD be in the wargame results.
        expect(wargamedGoals.has(proposedCandidates[i].goal)).toBe(true);
      }
    }

    // The wargame count should be roster size minus vetoed count.
    expect(wargamed.length).toBe(CHAMBER_GENERALS.length - vetoedIndices.size);

    // Check that no wargame transcript row mentions a vetoed candidate.
    const transcript = listChamberTranscript(project, campaign.id, sessionId);
    const wargameRows = transcript.filter((t) => t.phase === 'wargame');
    expect(wargameRows.length).toBe(CHAMBER_GENERALS.length - vetoedIndices.size);
  });

  test('the decision row stores the chosen candidate, the strongest dissent verbatim, and refining guidance', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Decision Test Campaign',
      goal: 'Verify decision persistence',
    });

    const sessionId = 'session-test-3';

    // Fixture dissent with leading/trailing whitespace and newline.
    const fixtureDissentString = '  Strong concern about closure timing\n';

    const calls: string[] = [];

    // Stub factory: record a specific dissent.
    const stubFactory: ChamberLLMFactory = (role: string, phase: string) => ({
      complete: async () => {
        calls.push(`${phase}:${role}`);

        if (phase === 'propose') {
          return JSON.stringify({
            goal: `Closure candidate from ${role}`,
            rationale: `${role} rationale`,
          });
        } else if (phase === 'veto') {
          // Record the fixture dissent from the operations general.
          // Veto candidate at index 4 (not the one the president will choose at index 0).
          if (role === 'operations') {
            return JSON.stringify({
              targetIndex: 4,
              dissent: fixtureDissentString,
            });
          }
          return JSON.stringify({
            targetIndex: null,
            dissent: null,
          });
        } else if (phase === 'wargame') {
          return JSON.stringify({
            critique: 'Wargame critique',
          });
        } else if (phase === 'decide') {
          // Choose the first candidate from wargamed (after filtering out vetoed index 0).
          // The original index 0 (operations) is vetoed, so the first wargamed candidate
          // is now the original index 1 (intelligence).
          return JSON.stringify({
            chosenIndex: 0,
            dissentIndex: 0,
            guidance: 'Proceed with careful monitoring',
            reasoning: 'Evidence supports closure with reservations',
          });
        }
        return JSON.stringify({});
      },
    });

    const args = {
      campaignId: campaign.id,
      sessionId,
      decidedAtSha: 'ghi9012',
      llm: stubFactory,
      model: 'test-model',
    };

    // Run the full chamber protocol.
    const candidates = await propose(project, args);
    const vetoes = await veto(project, args, candidates);
    const wargamed = await wargame(project, args, candidates, vetoes);
    const decision = await decide(project, args, wargamed, vetoes);

    // Check that the decision row has the correct values.
    expect(decision.outcome).toBe('decision');
    expect(decision.chosenCandidate).toBe(candidates[0].goal);
    expect(decision.refiningGuidance).toBe('Proceed with careful monitoring');

    // The strongest dissent should be stored EXACTLY as authored in the veto phase.
    // This tests the requirement that dissent strings are carried by reference and
    // compared by strict equality, without trim or normalization.
    expect(decision.strongestDissent).toBe(fixtureDissentString);

    // Round-trip via listChamberDecisions to confirm persistence.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions.length).toBeGreaterThan(0);

    const persistedDecision = decisions.find((d) => d.id === decision.id);
    expect(persistedDecision).toBeDefined();
    expect(persistedDecision!.strongestDissent).toBe(fixtureDissentString);
    expect(persistedDecision!.chosenCandidate).toBe(candidates[0].goal);
    expect(persistedDecision!.refiningGuidance).toBe('Proceed with careful monitoring');
  });
});
