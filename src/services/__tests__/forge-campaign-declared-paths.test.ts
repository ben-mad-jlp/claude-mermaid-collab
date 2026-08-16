// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgeCampaign,
} from '../campaign-forge';
import {
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
import { handleCampaignTool } from '../../mcp/campaign-tools';
import type { ProbeForgeInput } from '../campaign-validate';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'forge-campaign-declared-paths-'));
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

describe('forge-campaign-declared-paths', () => {
  it('forges a probe whose declaredPaths survive to get_campaign', async () => {
    const twoProbes: ProbeForgeInput[] = [
      {
        ref: 'probe-first',
        kind: 'command',
        environment: 'worktree',
        command: 'echo "first"',
        declaredPaths: ['src/services/campaign-pass.ts', 'src/mcp/campaign-tools.ts'],
      },
      {
        ref: 'probe-second',
        kind: 'command',
        environment: 'worktree',
        command: 'echo "second"',
      },
    ];

    // Forge the campaign
    const row = forgeCampaign(project, { title: 'Test Declared Paths', probes: twoProbes });
    expect(row).toBeDefined();
    expect(row.id).toBeDefined();

    // Call get_campaign via the handler
    const getResult = await handleCampaignTool('get_campaign', {
      project,
      campaignId: row.id,
    });
    expect(getResult).toBeDefined();

    // Parse the result
    const parsed = JSON.parse(getResult!);
    expect(parsed).toHaveProperty('probes');
    expect(parsed.probes).toHaveLength(2);

    // Find the probe by its distinctive command (not by index, since createdAt is shared)
    const probe = parsed.probes.find((p: any) => p.command === 'echo "first"');
    expect(probe).toBeDefined();

    // Assert declaredPaths match exactly
    expect(probe.declaredPaths).toEqual([
      'src/services/campaign-pass.ts',
      'src/mcp/campaign-tools.ts',
    ]);
  });
});
