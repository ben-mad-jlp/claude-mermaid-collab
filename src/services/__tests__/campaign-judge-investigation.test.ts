// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  recordProbeVerdict,
  listCampaignCompletions,
  latestCampaignCompletion,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  createTodo,
  _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import {
  judgeCampaignCompletion,
  type JudgeCampaignOpts,
} from '../campaign-completion-judge';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-judge-investigation-'));
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

describe('campaign-judge-investigation', () => {
  it('records what the judge examined, including any command it ran', async () => {
    // Create a campaign with a goal and a probe with a command.
    const campaign = createCampaign(project, {
      title: 'Investigation Test Campaign',
      goal: 'Verify the deployment is healthy',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'npm run healthcheck' },
      ],
    });

    // Record the probe as passing.
    const { listProbes } = await import('../campaign-store');
    const probes = listProbes(project, campaign.id);
    for (const probe of probes) {
      recordProbeVerdict(project, {
        probeId: probe.id,
        verdict: 'pass',
        environment: 'worktree',
        commitSha: 'abc123def456',
        evidence: 'Health check passed at 2026-08-16T10:30:00Z',
      });
    }

    // Stub the LLM to return a verdict with examination evidence.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          verdict: 'done',
          rationale: 'Health check passed and deployment is responsive',
          artifactsRead: ['/var/log/deployment.log', 'metrics.json'],
          commandsRun: ['curl http://localhost:3000/health', 'ps aux | grep node'],
        });
      },
    };

    // Judge the campaign.
    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'investigation-judge',
      ruledAtSha: 'sha123',
    });

    // Verify the completion record includes examined evidence.
    expect(result.verdict).toBe('done');
    expect(result.artifactsRead).toContain('/var/log/deployment.log');
    expect(result.artifactsRead).toContain('metrics.json');
    expect(result.commandsRun).toContain('curl http://localhost:3000/health');
    expect(result.commandsRun).toContain('ps aux | grep node');

    // Also verify the command from the probe itself is included.
    expect(result.commandsRun).toContain('npm run healthcheck');

    // Re-read from the store to verify persistence.
    const latest = latestCampaignCompletion(project, campaign.id);
    expect(latest).toBeTruthy();
    expect(latest!.artifactsRead).toContain('/var/log/deployment.log');
    expect(latest!.commandsRun).toContain('curl http://localhost:3000/health');
  });

  it('refuses a verdict that records no examined evidence', async () => {
    // Create a campaign with no probes (so the judge has nothing to examine).
    const campaign = createCampaign(project, {
      title: 'Vacuous Campaign',
      goal: 'Verify something',
      probes: [],
    });

    // Stub the LLM to return a valid verdict but with no examination evidence.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          verdict: 'done',
          rationale: 'Goal is satisfied (claim without evidence)',
          artifactsRead: [],
          commandsRun: [],
        });
      },
    };

    // Attempt to judge the campaign; it should reject because no evidence was examined.
    let threwError = false;
    let errorMessage = '';
    try {
      await judgeCampaignCompletion(project, campaign.id, {
        llm: fakeJudgmentLLM,
        judge: 'vacuous-judge',
        ruledAtSha: 'sha123',
      });
    } catch (err) {
      threwError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(threwError).toBe(true);
    expect(errorMessage).toContain('records no examined evidence');

    // Verify nothing was stored.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(0);
  });
});
