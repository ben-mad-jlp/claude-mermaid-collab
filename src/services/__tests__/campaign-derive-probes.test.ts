// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgeCampaignFromGoal,
  type ForgeCampaignResult,
} from '../campaign-forge';
import {
  listCampaigns,
  listProbes,
  _resetCampaignDbCache,
  type CampaignRow,
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
import { validateCampaign, type ProbeForgeInput } from '../campaign-validate';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-derive-probes-'));
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

describe('campaign-derive-probes', () => {
  it('derives a runnable probe set from a goal statement alone', async () => {
    // Create a fake LLM that returns a canned 2-probe derivation.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          probes: [
            {
              ref: 'check-build',
              kind: 'command',
              environment: 'worktree',
              command: 'bun run build',
            },
            {
              ref: 'check-tests',
              kind: 'command',
              environment: 'worktree',
              command: 'bun test',
              dependsOn: ['check-build'],
            },
          ],
        });
      },
    };

    const beforeCount = listCampaigns(project).length;

    // Forge a campaign with a goal but no probes.
    const result = await forgeCampaignFromGoal(
      project,
      { title: 'Build and Test', goal: 'Verify the build succeeds and all tests pass' },
      { llm: fakeJudgmentLLM },
    );

    // Expect a campaign to be created.
    expect(result.kind).toBe('campaign');
    expect((result as any).campaign).toBeDefined();
    const campaign = (result as { kind: 'campaign'; campaign: CampaignRow }).campaign;

    // Verify the campaign was written to the database.
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount + 1);

    // Verify the probes were created and linked.
    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(2);

    // Verify the probe commands are as derived.
    const buildProbe = probes.find((p) => p.command === 'bun run build');
    const testProbe = probes.find((p) => p.command === 'bun test');
    expect(buildProbe).toBeDefined();
    expect(testProbe).toBeDefined();

    // Verify the dependency is resolved to a real probe id (not a ref).
    expect(testProbe!.dependsOn).toHaveLength(1);
    expect(testProbe!.dependsOn[0]).toBe(buildProbe!.id);
  });

  it('every derived probe satisfies the existing probe validator', async () => {
    // Create a fake LLM that returns probes matching the validator's constraints.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        return JSON.stringify({
          probes: [
            {
              ref: 'validate-syntax',
              kind: 'command',
              environment: 'worktree',
              command: 'find . -name "*.ts" -type f | head -1',
              declaredPaths: ['src/**/*.ts'],
            },
            {
              ref: 'run-lint',
              kind: 'command',
              environment: 'worktree',
              command: 'npm run lint',
              dependsOn: ['validate-syntax'],
              declaredPaths: ['src/**/*.ts', '.eslintrc.json'],
            },
          ],
        });
      },
    };

    // Forge the campaign, which internally validates the derived probes.
    const result = await forgeCampaignFromGoal(
      project,
      { title: 'Code Quality', goal: 'Code is syntactically valid and passes linting' },
      { llm: fakeJudgmentLLM },
    );

    // The forge succeeded, so validation passed.
    expect(result.kind).toBe('campaign');
    const campaign = (result as { kind: 'campaign'; campaign: CampaignRow }).campaign;

    // Re-fetch the probes and validate them against the same validator.
    const probes = listProbes(project, campaign.id);
    const regenerated: ProbeForgeInput[] = probes.map((p) => ({
      ref: p.id, // Use id as ref for this exercise
      kind: p.kind,
      environment: p.environment,
      command: p.command,
      dependsOn: p.dependsOn.length > 0 ? p.dependsOn : undefined,
      declaredPaths: p.declaredPaths.length > 0 ? p.declaredPaths : undefined,
    }));

    // Validate the regenerated probes.
    const validation = validateCampaign({
      title: 'Code Quality',
      goal: 'Code is syntactically valid and passes linting',
      probes: regenerated,
    });

    expect(validation.ok).toBe(true);
  });
});
