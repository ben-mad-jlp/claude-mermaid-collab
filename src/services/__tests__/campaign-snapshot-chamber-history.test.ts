// Test that listCampaignsForSnapshot projects all chamber decisions as chamberHistory.
// The snapshot must carry the full history of deliberations oldest→newest, with chamber
// set to the latest entry, so the UI can navigate chamber decision history.
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
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-snap-history-'));
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

describe('listCampaignsForSnapshot chamberHistory', () => {
  it('projects every chamber decision as chamberHistory oldest to newest', () => {
    // Create a campaign.
    const campaign = createCampaign(projectDir, {
      title: 'Chamber history test campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });

    // Record first chamber decision with session-1 content.
    const decision1 = recordChamberDecision(projectDir, {
      campaignId: campaign.id,
      sessionId: 'chamber-session-1',
      outcome: 'decision',
      chosenCandidate: 'proposal-1',
      strongestDissent: null,
      refiningGuidance: 'Session 1 guidance',
      decidedAtSha: 'abc1234567890abc1234567890abc1234567890',
      transcript: [
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-1',
          phase: 'propose',
          role: 'proposer',
          model: 'claude-opus-5',
          content: 'Session 1 proposal: This is from session 1.',
        },
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-1',
          phase: 'veto',
          role: 'architect',
          model: 'claude-opus-5',
          content: 'Session 1 veto: No objections from session 1.',
        },
      ],
    });

    // Record second chamber decision with session-2 content.
    const decision2 = recordChamberDecision(projectDir, {
      campaignId: campaign.id,
      sessionId: 'chamber-session-2',
      outcome: 'inaction',
      chosenCandidate: null,
      strongestDissent: null,
      refiningGuidance: 'Session 2 guidance text',
      decidedAtSha: 'def1234567890def1234567890def1234567890',
      transcript: [
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-2',
          phase: 'propose',
          role: 'proposer',
          model: 'claude-sonnet-5',
          content: 'Session 2 proposal: A different proposal from session 2.',
        },
        {
          campaignId: campaign.id,
          sessionId: 'chamber-session-2',
          phase: 'wargame',
          role: 'engineer',
          model: 'claude-sonnet-5',
          content: 'Session 2 wargame: Session 2 engineer perspective.',
        },
      ],
    });

    // List campaigns and verify chamberHistory projection.
    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.chamberHistory).toBeDefined();

    // Assert chamberHistory has exactly 2 entries, oldest to newest.
    expect(found!.chamberHistory.length).toBe(2);

    // First entry should be session-1 (oldest).
    const first = found!.chamberHistory[0];
    expect(first.sessionId).toBe('chamber-session-1');
    expect(first.outcome).toBe('decision');
    expect(first.chosenCandidate).toBe('proposal-1');
    expect(first.refiningGuidance).toBe('Session 1 guidance');
    expect(first.decidedAtSha).toBe('abc1234567890abc1234567890abc1234567890');
    expect(first.decidedAt).toBe(decision1.createdAt);

    // Verify session-1 content is only in first entry.
    const session1ProposalContent = first.proposals.map((p) => p.content);
    expect(session1ProposalContent.join('|')).toContain('session 1');
    expect(session1ProposalContent.join('|')).not.toContain('session 2');

    // Second entry should be session-2 (newest).
    const second = found!.chamberHistory[1];
    expect(second.sessionId).toBe('chamber-session-2');
    expect(second.outcome).toBe('inaction');
    expect(second.chosenCandidate).toBeNull();
    expect(second.refiningGuidance).toBe('Session 2 guidance text');
    expect(second.decidedAtSha).toBe('def1234567890def1234567890def1234567890');
    expect(second.decidedAt).toBe(decision2.createdAt);

    // Verify session-2 content is only in second entry.
    const session2ProposalContent = second.proposals.map((p) => p.content);
    expect(session2ProposalContent.join('|')).toContain('session 2');
    expect(session2ProposalContent.join('|')).not.toContain('session 1');

    // Verify chamber points to the latest decision (session-2).
    expect(found!.chamber).not.toBeNull();
    expect(found!.chamber!.sessionId).toBe('chamber-session-2');
    expect(found!.chamber!.outcome).toBe('inaction');
  });

  it('a campaign with zero chamber decisions yields an empty chamberHistory and a null chamber', () => {
    // Create a campaign with no chamber decision.
    const campaign = createCampaign(projectDir, {
      title: 'No chamber history campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });

    // List campaigns and verify chamberHistory is empty and chamber is null.
    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.chamberHistory).toEqual([]);
    expect(found!.chamber).toBeNull();
  });
});
