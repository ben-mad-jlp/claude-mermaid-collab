// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCampaignPass,
  _resetCampaignPassDbCache,
  type CampaignPassDeps,
} from '../campaign-pass';
import {
  createCampaign,
  addProbe,
  recordProbeVerdict,
  listProbes,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  createTodo,
  _closeProject,
} from '../todo-store';
import {
  upsertMission,
  addCriterion,
  listCriteria,
  setCriterionMet,
  _resetMissionDbCache,
} from '../mission-store';
import { reconcileCampaignProbes } from '../campaign-reconcile';
import { getProbeMissionLink } from '../campaign-pass';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { _closeDb } from '../supervisor-store';
import { listOpenEscalations } from '../supervisor-store';
import { CAMPAIGN_FRONT_UNSATISFIED_KIND } from '../campaign-liveness-card';
import { storePath } from '../store-paths';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-e2e-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-end-to-end', () => {
  it('drives three probes through one campaign pass to the recorded counts', async () => {
    // (a) BASELINE: fresh tmpdir has no collab.db
    const collabDbPath = storePath('collab', project);
    expect(existsSync(collabDbPath)).toBe(false);

    // (b) FIXTURE: Create campaign with three probes
    const campaign = createCampaign(project, { title: 'Test campaign' });

    // Probes A and B: both fail with identical evidence (will be grouped)
    const probeA = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      command: 'echo probe-a',
    });

    const probeB = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      command: 'echo probe-b',
    });

    // Probe C: passes
    const probeC = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      command: 'echo probe-c',
    });

    // Record verdicts: A and B fail with identical evidence, C passes
    const identicalEvidence = 'Error: test failed';
    recordProbeVerdict(project, {
      probeId: probeA.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'sha0',
      evidence: identicalEvidence,
    });

    recordProbeVerdict(project, {
      probeId: probeB.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'sha0',
      evidence: identicalEvidence,
    });

    recordProbeVerdict(project, {
      probeId: probeC.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'sha0',
      evidence: null,
    });

    // (c) THE PASS: Run campaign pass with forgeMission stub
    const forgeMissionStub = (async (proj: string, input: any) => {
      // Create the mission todo
      const missionTodo = await createTodo(proj, {
        allowOrphan: true,
        ownerSession: 's1',
        title: `[MISSION] ${input.title}`,
        kind: 'mission',
      });

      // Upsert to create mission row
      upsertMission(proj, missionTodo.id);

      // Add criteria from input
      for (const criterionText of input.criteria) {
        addCriterion(proj, missionTodo.id, criterionText);
      }

      // Return a stub result with only missionId (cast to suppress type check for other fields)
      return {
        missionId: missionTodo.id,
      } as unknown as CampaignPassDeps['forgeMission'];
    }) as any;

    const deps: CampaignPassDeps = {
      forgeMission: forgeMissionStub,
      execProbe: async () => ({ verdict: 'fail' as const, evidence: identicalEvidence }),
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // (d) missionsForged: should be 1 (A and B grouped by identical evidence)
    const missionsForged = result.forged.length;
    expect(missionsForged).toBe(1);
    expect(typeof missionsForged).toBe('number');

    // (e) probesLinked: should be 2 (A and B linked to the forged mission)
    let probesLinked = 0;
    for (const probeId of [probeA.id, probeB.id, probeC.id]) {
      const link = getProbeMissionLink(project, probeId);
      if (link && link.missionId === result.forged[0].missionId) {
        probesLinked++;
      }
    }
    expect(probesLinked).toBe(2);
    expect(typeof probesLinked).toBe('number');

    // (f) escalationsRaised: should be 0 (pass raised no cards)
    const escalationsRaised = listOpenEscalations({
      project,
      kind: CAMPAIGN_FRONT_UNSATISFIED_KIND,
    }).length;
    expect(escalationsRaised).toBe(0);
    expect(typeof escalationsRaised).toBe('number');

    // (g) Converge the mission: mark all criteria as met
    const missionId = result.forged[0].missionId;
    const criteria = listCriteria(project, missionId);
    for (const criterion of criteria) {
      setCriterionMet(project, criterion.id, true);
    }

    // (h) Reconcile
    await reconcileCampaignProbes(project, campaign.id);

    // (i) probesAdvanced: should be 2 (A and B now passing after reconcile)
    const probesAfterReconcile = listProbes(project, campaign.id);
    let probesAdvanced = 0;
    const originallyFailingProbeIds = [probeA.id, probeB.id];
    for (const probe of probesAfterReconcile) {
      if (originallyFailingProbeIds.includes(probe.id) && probe.verdict === 'pass') {
        probesAdvanced++;
      }
    }
    expect(probesAdvanced).toBe(2);
    expect(typeof probesAdvanced).toBe('number');
  });
});
