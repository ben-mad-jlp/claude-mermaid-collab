// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCampaignTool } from '../../mcp/campaign-tools.js';
import { _closeDb } from '../orchestrator-config';
import { setupMCPServer } from '../../mcp/setup.js';
import {
  recordProbeVerdict,
  listProbes,
  _resetCampaignDbCache,
  type ProbeVerdictInput,
} from '../campaign-store';
import { campaignFront } from '../campaign-front';
import { _closeProject } from '../todo-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  _closeDb();
  project = mkdtempSync(join(tmpdir(), 'campaign-mcp-'));
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

describe('campaign-mcp-surface', () => {
  test('registers forge_campaign, the list verb and the read verb in the advertised tool list', async () => {
    // Setup the server and get the tools/list handler
    const server = await setupMCPServer();
    const handler = (server as any)._requestHandlers.get('tools/list');

    if (!handler) {
      throw new Error('tools/list handler not found');
    }

    // Invoke the handler to get the tool list
    const result = await handler({ method: 'tools/list', params: {} }, {} as any);

    // Build a set of tool names from the result
    const toolNames = new Set(result.tools.map((t: any) => t.name));

    // Assert that all three campaign tools are registered
    expect(toolNames.has('forge_campaign')).toBe(true);
    expect(toolNames.has('list_campaigns')).toBe(true);
    expect(toolNames.has('get_campaign')).toBe(true);
  });

  test('returns every campaign in the project with its probe count from the list verb', async () => {
    // Forge the first campaign with 1 probe
    const campaign1Result = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign One',
      probes: [{ ref: 'probe-a', kind: 'command', environment: 'worktree', command: 'echo "a"' }],
    });
    const campaign1 = JSON.parse(campaign1Result!);

    // Forge the second campaign with 3 probes
    const campaign2Result = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign Two',
      probes: [
        { ref: 'probe-x', kind: 'command', environment: 'worktree', command: 'echo "x"' },
        { ref: 'probe-y', kind: 'command', environment: 'worktree', command: 'echo "y"' },
        { ref: 'probe-z', kind: 'command', environment: 'worktree', command: 'echo "z"' },
      ],
    });
    const campaign2 = JSON.parse(campaign2Result!);

    // List campaigns and verify probe counts
    const listResult = await handleCampaignTool('list_campaigns', { project });
    const campaigns = JSON.parse(listResult!) as any[];

    expect(campaigns.length).toBe(2);

    // Index campaigns by id and verify probe counts
    const campaignMap = new Map(campaigns.map((c: any) => [c.id, c]));
    expect(campaignMap.get(campaign1.id)!.probeCount).toBe(1);
    expect(campaignMap.get(campaign2.id)!.probeCount).toBe(3);
  });

  test('returns probes, verdicts and the computed front from the read verb', async () => {
    // Forge a campaign with a dependency chain: a → b (b depends on a)
    const forgeResult = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign With Dependencies',
      probes: [
        { ref: 'root-probe', kind: 'command', environment: 'worktree', command: 'echo "root"' },
        {
          ref: 'dependent-probe',
          kind: 'command',
          environment: 'worktree',
          command: 'echo "dependent"',
          dependsOn: ['root-probe'],
        },
      ],
    });
    const campaign = JSON.parse(forgeResult!);
    const campaignId = campaign.id;

    // List probes to get their real ids (forgeCampaign resolves refs to ids)
    const probes = listProbes(project, campaignId);
    expect(probes.length).toBe(2);

    // Find the root and dependent probes by their command
    const rootProbe = probes.find((p) => p.command === 'echo "root"')!;
    const dependentProbe = probes.find((p) => p.command === 'echo "dependent"')!;

    expect(rootProbe).toBeDefined();
    expect(dependentProbe).toBeDefined();

    // Record a passing verdict on the root probe
    const verdict: ProbeVerdictInput = {
      probeId: rootProbe.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    };
    recordProbeVerdict(project, verdict);

    // Get the campaign via the read verb
    const getResult = await handleCampaignTool('get_campaign', { project, campaignId });
    const campaignData = JSON.parse(getResult!);

    // Verify the structure
    expect(campaignData.campaignId).toBe(campaignId);
    expect(campaignData.probes.length).toBe(2);

    // Find the enriched probes in the response
    const rootProbeEnriched = campaignData.probes.find((p: any) => p.command === 'echo "root"')!;
    const dependentProbeEnriched = campaignData.probes.find(
      (p: any) => p.command === 'echo "dependent"'
    )!;

    // Verify that the recorded verdict appears in the root probe's verdicts
    expect(rootProbeEnriched.verdicts.length).toBe(1);
    expect(rootProbeEnriched.verdicts[0].verdict).toBe('pass');

    // Verify that the dependent probe has no verdicts (it's not been run)
    expect(dependentProbeEnriched.verdicts.length).toBe(0);

    // Verify front derivation: root is passing so it's excluded, dependent is now ready (in the front)
    const front = campaignData.front;
    const frontIds = front.map((p: any) => p.id);

    // The front should contain only the dependent probe (root is passing)
    expect(frontIds.length).toBe(1);
    expect(frontIds[0]).toBe(dependentProbe.id);

    // Verify parity with campaignFront computation
    const expectedFront = campaignFront(project, campaignId);
    const expectedFrontIds = expectedFront.map((p) => p.id);
    expect(frontIds).toEqual(expectedFrontIds);
  });
});
