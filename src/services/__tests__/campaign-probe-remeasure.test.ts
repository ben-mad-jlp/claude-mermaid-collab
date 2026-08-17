// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  addProbe,
  listProbeVerdicts,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  runCampaignPass,
  _resetCampaignPassDbCache,
  type CampaignPassDeps,
} from '../campaign-pass';
import { campaignFront } from '../campaign-front';
import { _closeProject, createTodo } from '../todo-store';
import { upsertMission } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { _closeDb } from '../supervisor-store';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-remeasure-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-probe-remeasure', () => {
  it('re-measures a front probe on every pass and empties the front once it flips to passing', async () => {
    // Create a campaign with one command probe, starting 'not-run'.
    const campaign = createCampaign(project, { title: 'test-campaign' });
    const probe = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      command: 'test1',
    });

    // Track execProbe calls: first call returns 'fail', second returns 'pass'.
    let callCount = 0;
    const mockExecProbe = async () => {
      callCount++;
      if (callCount === 1) {
        return { verdict: 'fail' as const, evidence: 'boom' };
      } else {
        return { verdict: 'pass' as const, evidence: null };
      }
    };

    // Mock forgeMission to create and upsert a mission.
    const mockForgeMission = async (proj: string, input: any) => {
      const missionTodo = await createTodo(proj, {
        allowOrphan: true,
        ownerSession: 's1',
        title: input.title,
        kind: 'mission',
      });
      upsertMission(proj, missionTodo.id);
      return { missionId: missionTodo.id } as any;
    };

    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    const deps: CampaignPassDeps = {
      execProbe: mockExecProbe,
      commitSha: () => 'sha-test',
      forgeMission: mockForgeMission,
      llm: approvingLlm,
    };

    // First pass: probe is 'not-run', enters front, executes and records 'fail'.
    const result1 = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(result1.executed).toContain(probe.id);
    expect(callCount).toBe(1);

    // Verify the probe verdict was recorded as 'fail'.
    const verdicts1 = listProbeVerdicts(project, probe.id);
    expect(verdicts1.length).toBe(1);
    expect(verdicts1[0].verdict).toBe('fail');

    // Verify the front still contains this probe (it's failing).
    const front1 = campaignFront(project, campaign.id);
    expect(front1.map((p) => p.id)).toContain(probe.id);

    // Second pass: probe is 'fail', still in front, executes and records 'pass'.
    const result2 = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(result2.executed).toContain(probe.id);
    expect(callCount).toBe(2);

    // Verify two verdicts were recorded, second is 'pass'.
    const verdicts2 = listProbeVerdicts(project, probe.id);
    expect(verdicts2.length).toBe(2);
    expect(verdicts2[1].verdict).toBe('pass');

    // Verify the front is now empty (probe is 'pass').
    const front2 = campaignFront(project, campaign.id);
    expect(front2.length).toBe(0);
  });
});
