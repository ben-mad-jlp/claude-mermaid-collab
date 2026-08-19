// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  createCampaign,
  recordChamberTranscript,
  recordChamberDecision,
  listChamberTranscript,
  listChamberDecisions,
  _resetCampaignDbCache,
  openCampaignDb,
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
  project = mkdtempSync(join(tmpdir(), 'campaign-chamber-'));
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

describe('campaign-chamber-store', () => {
  test('a fresh openCampaignDb creates the chamber_transcript and chamber_decision tables', () => {
    const db = openCampaignDb(project);

    // Check that chamber_transcript table exists by reading its schema.
    const transcriptInfo = db
      .prepare("PRAGMA table_info(chamber_transcript)")
      .all() as Array<{ name: string }>;
    expect(transcriptInfo.length).toBeGreaterThan(0);
    const transcriptColumns = transcriptInfo.map((col) => col.name);
    expect(transcriptColumns).toContain('id');
    expect(transcriptColumns).toContain('campaignId');
    expect(transcriptColumns).toContain('sessionId');
    expect(transcriptColumns).toContain('phase');
    expect(transcriptColumns).toContain('role');
    expect(transcriptColumns).toContain('model');
    expect(transcriptColumns).toContain('content');
    expect(transcriptColumns).toContain('createdAt');

    // Check that chamber_decision table exists by reading its schema.
    const decisionInfo = db
      .prepare("PRAGMA table_info(chamber_decision)")
      .all() as Array<{ name: string }>;
    expect(decisionInfo.length).toBeGreaterThan(0);
    const decisionColumns = decisionInfo.map((col) => col.name);
    expect(decisionColumns).toContain('id');
    expect(decisionColumns).toContain('campaignId');
    expect(decisionColumns).toContain('sessionId');
    expect(decisionColumns).toContain('outcome');
    expect(decisionColumns).toContain('chosenCandidate');
    expect(decisionColumns).toContain('strongestDissent');
    expect(decisionColumns).toContain('refiningGuidance');
    expect(decisionColumns).toContain('decidedAtSha');
    expect(decisionColumns).toContain('createdAt');
  });

  test('records a chamber decision with accompanying transcript rows and round-trips them', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify deliberation system',
    });

    // Record a chamber decision with accompanying transcript rows.
    const decisionRecord = recordChamberDecision(project, {
      campaignId: campaign.id,
      sessionId: 'session-123',
      outcome: 'decision',
      chosenCandidate: 'Proposed Feature A',
      strongestDissent: 'Concern about scope creep',
      refiningGuidance: 'Prioritize user testing before implementation',
      decidedAtSha: 'def5678',
      transcript: [
        {
          campaignId: campaign.id,
          sessionId: 'session-123',
          phase: 'propose',
          role: 'president',
          model: 'claude-opus-5',
          content: 'The panel proposes Feature A as the best approach',
        },
        {
          campaignId: campaign.id,
          sessionId: 'session-123',
          phase: 'veto',
          role: 'skeptic',
          model: 'claude-opus-5',
          content: 'I have concerns about the scope expansion',
        },
        {
          campaignId: campaign.id,
          sessionId: 'session-123',
          phase: 'wargame',
          role: 'general',
          model: 'claude-opus-5',
          content: 'Let us address the concern by focusing on core features first',
        },
        {
          campaignId: campaign.id,
          sessionId: 'session-123',
          phase: 'decide',
          role: 'president',
          content: 'We decide to proceed with testing before full implementation',
        },
      ],
    });

    // Assert the decision was recorded correctly.
    expect(decisionRecord.id).toBeGreaterThan(0);
    expect(decisionRecord.campaignId).toBe(campaign.id);
    expect(decisionRecord.sessionId).toBe('session-123');
    expect(decisionRecord.outcome).toBe('decision');
    expect(decisionRecord.chosenCandidate).toBe('Proposed Feature A');
    expect(decisionRecord.strongestDissent).toBe('Concern about scope creep');
    expect(decisionRecord.refiningGuidance).toBe('Prioritize user testing before implementation');
    expect(decisionRecord.decidedAtSha).toBe('def5678');

    // List decisions and verify the record round-trips.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual(decisionRecord);

    // List transcript entries and verify they round-trip.
    const transcripts = listChamberTranscript(project, campaign.id, 'session-123');
    expect(transcripts).toHaveLength(4);
    expect(transcripts[0].phase).toBe('propose');
    expect(transcripts[0].role).toBe('president');
    expect(transcripts[0].model).toBe('claude-opus-5');
    expect(transcripts[1].phase).toBe('veto');
    expect(transcripts[1].role).toBe('skeptic');
    expect(transcripts[2].phase).toBe('wargame');
    expect(transcripts[2].role).toBe('general');
    expect(transcripts[3].phase).toBe('decide');
    expect(transcripts[3].role).toBe('president');
    expect(transcripts[3].model).toBeNull(); // model is optional
  });

  test('rejects a chamber decision with an invalid phase in transcript', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify deliberation system',
    });

    // Attempt to record a decision with an invalid phase in the transcript.
    let threwError = false;
    let errorMessage = '';
    try {
      recordChamberDecision(project, {
        campaignId: campaign.id,
        sessionId: 'session-123',
        outcome: 'decision',
        decidedAtSha: 'def5678',
        transcript: [
          {
            campaignId: campaign.id,
            sessionId: 'session-123',
            phase: 'invalid-phase' as any,
            role: 'president',
            content: 'This should fail',
          },
        ],
      });
    } catch (err: any) {
      threwError = true;
      errorMessage = err.message;
    }

    expect(threwError).toBe(true);
    expect(errorMessage).toContain('invalid chamber transcript entry phase');

    // Verify that no decision or transcript rows were inserted (transactional atomicity).
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(0);

    const transcripts = listChamberTranscript(project, campaign.id, 'session-123');
    expect(transcripts).toHaveLength(0);
  });

  test('rejects a chamber decision with an invalid outcome', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify deliberation system',
    });

    // Attempt to record a decision with an invalid outcome.
    let threwError = false;
    let errorMessage = '';
    try {
      recordChamberDecision(project, {
        campaignId: campaign.id,
        sessionId: 'session-123',
        outcome: 'invalid-outcome' as any,
        decidedAtSha: 'def5678',
      });
    } catch (err: any) {
      threwError = true;
      errorMessage = err.message;
    }

    expect(threwError).toBe(true);
    expect(errorMessage).toContain('invalid chamber decision outcome');

    // Verify that no decision rows were inserted.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(0);
  });

  it('a chamber decision round-trips its frontFingerprint through the store', () => {
    // Open the campaign DB and verify the frontFingerprint column exists.
    const db = openCampaignDb(project);
    const tableInfo = db
      .prepare("PRAGMA table_info(chamber_decision)")
      .all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((col) => col.name);
    expect(columnNames).toContain('frontFingerprint');

    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify frontFingerprint persistence',
    });

    // Record a chamber decision with frontFingerprint.
    recordChamberDecision(project, {
      campaignId: campaign.id,
      sessionId: '__test_session__',
      outcome: 'decision',
      decidedAtSha: 'def5678',
      frontFingerprint: 'p1@aaa|p2@bbb',
    });

    // List decisions and verify the frontFingerprint round-trips.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].frontFingerprint).toBe('p1@aaa|p2@bbb');
  });
});
