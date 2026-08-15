// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProbeForgeInput } from '../campaign-validate';
import type { CampaignPassDeps } from '../campaign-pass';
import { forgeCampaign } from '../campaign-forge';
import {
  listCampaigns,
  listProbes,
  recordProbeVerdict,
  listProbeVerdicts,
  _resetCampaignDbCache,
} from '../campaign-store';
import { campaignFront } from '../campaign-front';
import { runCampaignPass, _resetCampaignPassDbCache } from '../campaign-pass';
import { _closeProject } from '../todo-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { _closeDb } from '../supervisor-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-rig-e2e-'));
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

describe('campaign-rig-end-to-end', () => {
  it('forges a seven-probe rig campaign and drives its front probe to a recorded verdict', async () => {
    // BASELINE: no rig campaigns initially
    const baseCampaigns = listCampaigns(project)
      .filter(c => listProbes(project, c.id).some(p => p.environment === 'rig'))
      .length;
    expect(baseCampaigns).toBe(0);

    // FORGE: create 7-probe campaign with dependencies
    const title = 'seven-probe-rig';
    const probes: ProbeForgeInput[] = [
      { ref: 'p1', kind: 'command', environment: 'rig', command: 'echo rig-p1' },
      { ref: 'p2', kind: 'command', environment: 'rig', command: 'echo rig-p2' },
      { ref: 'p3', kind: 'command', environment: 'rig', command: 'echo rig-p3' },
      { ref: 'p4', kind: 'command', environment: 'rig', command: 'echo rig-p4' },
      { ref: 'p5', kind: 'command', environment: 'rig', command: 'echo rig-p5' },
      { ref: 'p6', kind: 'command', environment: 'rig', command: 'echo rig-p6' },
      {
        ref: 'p7',
        kind: 'command',
        environment: 'rig',
        command: 'echo rig-p7',
        dependsOn: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      },
    ];
    const campaign = forgeCampaign(project, { title, probes });

    expect(listCampaigns(project).length).toBe(1);
    const allProbes = listProbes(project, campaign.id);
    expect(allProbes.length).toBe(7);

    // Resolve probe ids by command matching
    const probesByCommand = new Map(allProbes.map(p => [p.command, p.id]));
    const p1Id = probesByCommand.get('echo rig-p1')!;
    const p2Id = probesByCommand.get('echo rig-p2')!;
    const p3Id = probesByCommand.get('echo rig-p3')!;
    const p4Id = probesByCommand.get('echo rig-p4')!;
    const p5Id = probesByCommand.get('echo rig-p5')!;
    const p6Id = probesByCommand.get('echo rig-p6')!;
    const p7Id = probesByCommand.get('echo rig-p7')!;

    // SEED: record p1-p6 as pass with seedsha0
    recordProbeVerdict(project, {
      probeId: p1Id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'seedsha0',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p2Id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'seedsha0',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p3Id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'seedsha0',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p4Id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'seedsha0',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p5Id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'seedsha0',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p6Id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'seedsha0',
      evidence: null,
    });

    // Verify front is just p7
    const front = campaignFront(project, campaign.id);
    expect(front.length).toBe(1);
    expect(front[0].id).toBe(p7Id);

    // PASS: run campaign pass with injected deps
    const deps: CampaignPassDeps = {
      execProbe: async () => ({ verdict: 'pass', evidence: null }),
      commitSha: () => 'rigsha1',
    };
    const result = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(result.executed).toContain(p7Id);

    // RE-READ: flatten verdict rows from store
    const allVerdicts = [
      ...listProbeVerdicts(project, p1Id),
      ...listProbeVerdicts(project, p2Id),
      ...listProbeVerdicts(project, p3Id),
      ...listProbeVerdicts(project, p4Id),
      ...listProbeVerdicts(project, p5Id),
      ...listProbeVerdicts(project, p6Id),
      ...listProbeVerdicts(project, p7Id),
    ];
    expect(allVerdicts.length).toBe(7);

    const rigsha1Rows = allVerdicts.filter(r => r.commitSha === 'rigsha1');
    expect(rigsha1Rows.length).toBe(1);

    const rigsha1Row = rigsha1Rows[0]!;
    expect(rigsha1Row.environment).toBe('rig');
    expect(typeof rigsha1Row.commitSha === 'string' && rigsha1Row.commitSha.length > 0).toBe(true);
  });
});
