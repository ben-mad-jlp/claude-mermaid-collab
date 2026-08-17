// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  listMissionProposals,
  listProposalObjections,
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
import { ruleMissionProposal, ruleThenForgeMission } from '../campaign-mission-proposal';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-mission-proposal-ruling-'));
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

describe('campaign-mission-proposal-ruling', () => {
  test('a proposed mission is ruled on by the panel before any work is spawned', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify system behavior',
    });

    const proposedGoal = 'Implement authentication system';

    // Stub JudgmentLLM: return no objections from all three lenses.
    const llm: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          objection: null,
          reasoning: 'This lens sees no objection',
        });
      },
    };

    // Track whether forgeMission is called and capture the moment it's called.
    let forgeMissionCallCount = 0;
    let proposalCountAtForgeTime = 0;

    const forgeMissionSpy = async (project: string, input: any) => {
      forgeMissionCallCount++;
      // At the moment forgeMission is called, the proposal should already be persisted.
      proposalCountAtForgeTime = listMissionProposals(project, campaign.id).length;
      return { missionId: 'fake-mission-id' };
    };

    // Rule the proposal and then forge if approved.
    const result = await ruleThenForgeMission(
      project,
      {
        campaignId: campaign.id,
        proposedGoal,
        llm,
        judge: 'test-judge',
        ruledAtSha: 'abc1234',
        forgeInput: { title: 'Test Mission', criteria: ['Test criterion'] },
      },
      { forgeMission: forgeMissionSpy },
    );

    // The ruling should be 'approved' (no objections).
    expect(result.proposal.ruling).toBe('approved');

    // forgeMission should have been called exactly once.
    expect(forgeMissionCallCount).toBe(1);

    // The proposal should have been persisted BEFORE forgeMission was called.
    // We capture the count at forge time and assert it's >= 1.
    expect(proposalCountAtForgeTime).toBeGreaterThanOrEqual(1);

    // Verify the proposal is in the database.
    const proposals = listMissionProposals(project, campaign.id);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].proposedGoal).toBe(proposedGoal);
    expect(proposals[0].ruling).toBe('approved');
  });

  test('records the proposed goal and each lens objection when a proposal is rejected', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify system behavior',
    });

    const proposedGoal = 'Rewrite entire codebase in Rust';

    // Stub JudgmentLLM: return objections from two of the three lenses.
    let callCount = 0;
    const llm: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        callCount++;
        // First and second calls have objections; third has none.
        if (callCount === 1 || callCount === 2) {
          return JSON.stringify({
            objection: `Objection from lens ${callCount}`,
            reasoning: `This is the reasoning for objection ${callCount}`,
          });
        }
        return JSON.stringify({
          objection: null,
          reasoning: 'No objection from this lens',
        });
      },
    };

    // Track whether forgeMission is called.
    let forgeMissionCallCount = 0;

    const forgeMissionSpy = async (project: string, input: any) => {
      forgeMissionCallCount++;
      return { missionId: 'fake-mission-id' };
    };

    // Rule the proposal and then forge if approved.
    const result = await ruleThenForgeMission(
      project,
      {
        campaignId: campaign.id,
        proposedGoal,
        llm,
        judge: 'test-judge',
        ruledAtSha: 'def5678',
        forgeInput: { title: 'Test Mission', criteria: ['Test criterion'] },
      },
      { forgeMission: forgeMissionSpy },
    );

    // The ruling should be 'rejected' (objections present).
    expect(result.proposal.ruling).toBe('rejected');

    // forgeMission should NOT have been called since the proposal was rejected.
    expect(forgeMissionCallCount).toBe(0);

    // Verify the proposal is recorded with the proposed goal verbatim.
    const proposals = listMissionProposals(project, campaign.id);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const proposal = proposals[0];
    expect(proposal.proposedGoal).toBe(proposedGoal);
    expect(proposal.ruling).toBe('rejected');

    // Verify objections are recorded: should have 2 objections (from the first two lenses).
    const objections = listProposalObjections(project, proposal.id);
    expect(objections.length).toBe(2);

    // Verify objection texts are recorded verbatim.
    expect(objections[0].objection).toBe('Objection from lens 1');
    expect(objections[0].reasoning).toBe('This is the reasoning for objection 1');
    expect(objections[1].objection).toBe('Objection from lens 2');
    expect(objections[1].reasoning).toBe('This is the reasoning for objection 2');
  });
});
