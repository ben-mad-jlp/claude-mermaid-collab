// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgeCampaignFromGoal,
} from '../campaign-forge';
import {
  listCampaigns,
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
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-derive-questions-'));
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

describe('campaign-derive-questions', () => {
  it('returns questions instead of probes when the goal leaves what-to-measure ambiguous', async () => {
    // Create a fake LLM that returns questions for an ambiguous goal.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          questions: [
            'Which specific system should we measure?',
            'Are we measuring performance, correctness, or both?',
            'What is the baseline for comparison?',
          ],
        });
      },
    };

    const beforeCount = listCampaigns(project).length;

    // Try to forge a campaign with an ambiguous goal.
    const result = await forgeCampaignFromGoal(
      project,
      { title: 'Vague Campaign', goal: 'Make things faster' },
      { llm: fakeJudgmentLLM },
    );

    // Expect questions, not a campaign.
    expect(result.kind).toBe('questions');
    expect((result as any).questions).toBeDefined();
    expect((result as any).questions).toHaveLength(3);
    expect((result as any).questions[0]).toContain('system');

    // Verify no campaign was created.
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('asks nothing when only the implementation of a measurement is open', async () => {
    // Create a fake LLM that returns probes when the measurement is clear but
    // the implementation is open.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          probes: [
            {
              ref: 'check-speed',
              kind: 'command',
              environment: 'worktree',
              command: 'time node index.js',
            },
          ],
        });
      },
    };

    const beforeCount = listCampaigns(project).length;

    // Forge a campaign with a clear goal (what to measure).
    const result = await forgeCampaignFromGoal(
      project,
      { title: 'Performance Check', goal: 'The startup time is under 100ms' },
      { llm: fakeJudgmentLLM },
    );

    // Expect a campaign, not questions.
    expect(result.kind).toBe('campaign');
    expect((result as any).campaign).toBeDefined();

    // Verify a campaign was created.
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount + 1);
  });
});
