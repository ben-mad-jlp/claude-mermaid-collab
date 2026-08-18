// Test that listCampaignsForSnapshot projects chamber deliberations onto BridgeCampaign.
// The snapshot must carry the chamber outcome, decision, and verbatim veto content so the UI
// can display chamber deliberation details without a second query.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaign, recordChamberDecision, _resetCampaignDbCache } from '../campaign-store.ts';
import { listCampaignsForSnapshot } from '../campaign-snapshot.ts';
import { _closeProject } from '../todo-store.ts';
import { _closeLedgerDb } from '../worker-ledger.ts';
import { _closeAllCollabDbs } from '../collab-db.ts';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-snap-chamber-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  process.env.MERMAID_SUPERVISOR_DIR = projectDir;
  _resetCampaignDbCache();
  _closeAllCollabDbs();
});

afterEach(() => {
  _closeProject(projectDir);
  _resetCampaignDbCache(projectDir);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(projectDir, { recursive: true, force: true });
});

describe('listCampaignsForSnapshot chamber deliberation', () => {
  it('a campaign with a chamber decision projects the verbatim veto reason and refining guidance', () => {
    // Create a campaign.
    const campaign = createCampaign(projectDir, {
      title: 'Chamber test campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });

    // Record a chamber decision with all four phases.
    const vetoReason = 'This proposal conflicts with the architectural constraints.\nIt would require extensive refactoring.';
    const guidanceText = 'Prefer a phased approach that respects the existing module boundaries.';

    recordChamberDecision(projectDir, {
      campaignId: campaign.id,
      sessionId: 'chamber-session-1',
      outcome: 'decision',
      chosenCandidate: 'proposal-2',
      strongestDissent: 'proposal-1',
      refiningGuidance: guidanceText,
      decidedAtSha: 'abc1234567890abc1234567890abc1234567890',
      transcript: [
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-1',
          phase: 'propose',
          role: 'proposer',
          model: 'claude-opus-5',
          content: 'Here is the first proposal: add feature X.',
        },
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-1',
          phase: 'veto',
          role: 'architect',
          model: 'claude-opus-5',
          content: vetoReason,
        },
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-1',
          phase: 'wargame',
          role: 'engineer',
          model: 'claude-opus-5',
          content: 'We could split this into two phases.',
        },
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-1',
          phase: 'decide',
          role: 'judge',
          model: 'claude-opus-5',
          content: 'The chamber has decided to pursue proposal-2 with phased rollout.',
        },
      ],
    });

    // List campaigns and verify the chamber projection.
    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.chamber).toBeDefined();
    expect(found!.chamber).not.toBeNull();

    const chamber = found!.chamber!;

    // Verify decision metadata.
    expect(chamber.sessionId).toBe('chamber-session-1');
    expect(chamber.outcome).toBe('decision');
    expect(chamber.chosenCandidate).toBe('proposal-2');
    expect(chamber.strongestDissent).toBe('proposal-1');
    expect(chamber.refiningGuidance).toBe(guidanceText);
    expect(chamber.decidedAtSha).toBe('abc1234567890abc1234567890abc1234567890');

    // Verify proposals bucket.
    expect(chamber.proposals.length).toBeGreaterThanOrEqual(1);
    expect(chamber.proposals[0].phase).toBe('propose');
    expect(chamber.proposals[0].role).toBe('proposer');
    expect(chamber.proposals[0].model).toBe('claude-opus-5');
    expect(chamber.proposals[0].content).toContain('first proposal');

    // Verify vetoes bucket: verbatim content is critical.
    expect(chamber.vetoes.length).toBeGreaterThanOrEqual(1);
    expect(chamber.vetoes[0].phase).toBe('veto');
    expect(chamber.vetoes[0].role).toBe('architect');
    expect(chamber.vetoes[0].content).toBe(vetoReason); // Byte-for-byte match, not truncated.

    // Verify wargame bucket.
    expect(chamber.wargame.length).toBeGreaterThanOrEqual(1);
    expect(chamber.wargame[0].phase).toBe('wargame');
    expect(chamber.wargame[0].role).toBe('engineer');

    // Verify decision bucket.
    expect(chamber.decision.length).toBeGreaterThanOrEqual(1);
    expect(chamber.decision[0].phase).toBe('decide');
    expect(chamber.decision[0].role).toBe('judge');

    // Verify that createdAt is set on all entries.
    for (const bucket of [chamber.proposals, chamber.vetoes, chamber.wargame, chamber.decision]) {
      for (const entry of bucket) {
        expect(entry.createdAt).toBeGreaterThan(0);
      }
    }
  });

  it('a campaign with no chamber rows yields a null chamber', () => {
    // Create a campaign with no chamber decision.
    const campaign = createCampaign(projectDir, {
      title: 'No chamber campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });

    // List campaigns and verify chamber is null.
    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.chamber).toBeNull();
  });
});
