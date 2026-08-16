// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  recordMissionProposal,
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

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-mission-proposal-'));
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

describe('campaign-mission-proposal-store', () => {
  test('records a rejected mission proposal with per-lens objections and round-trips it', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify system behavior',
    });

    // Record a rejected mission proposal with two lens objections.
    const proposalRecord = recordMissionProposal(project, {
      campaignId: campaign.id,
      proposedGoal: 'Implement feature X to solve problem Y',
      ruling: 'rejected',
      ruledAtSha: 'abc1234',
      rationale: 'Not aligned with roadmap',
      objections: [
        {
          lens: 'goal-fit',
          objection: 'Goal does not align with strategic priorities',
          reasoning: 'The proposed feature addresses a non-priority area',
        },
        {
          lens: 'refuter',
          objection: 'An existing system already provides this functionality',
          reasoning: 'Feature parity exists in the legacy subsystem',
        },
      ],
    });

    // Assert the proposal was recorded correctly.
    expect(proposalRecord.id).toBeGreaterThan(0);
    expect(proposalRecord.campaignId).toBe(campaign.id);
    expect(proposalRecord.proposedGoal).toBe('Implement feature X to solve problem Y');
    expect(proposalRecord.ruling).toBe('rejected');
    expect(proposalRecord.ruledAtSha).toBe('abc1234');
    expect(proposalRecord.rationale).toBe('Not aligned with roadmap');
    expect(proposalRecord.missionId).toBeNull();

    // List proposals and verify the record round-trips.
    const proposals = listMissionProposals(project, campaign.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual(proposalRecord);

    // List objections for the proposal and verify they round-trip in insertion order.
    const objections = listProposalObjections(project, proposalRecord.id);
    expect(objections).toHaveLength(2);

    expect(objections[0].proposalId).toBe(proposalRecord.id);
    expect(objections[0].lens).toBe('goal-fit');
    expect(objections[0].objection).toBe('Goal does not align with strategic priorities');
    expect(objections[0].reasoning).toBe('The proposed feature addresses a non-priority area');

    expect(objections[1].proposalId).toBe(proposalRecord.id);
    expect(objections[1].lens).toBe('refuter');
    expect(objections[1].objection).toBe('An existing system already provides this functionality');
    expect(objections[1].reasoning).toBe('Feature parity exists in the legacy subsystem');
  });
});
