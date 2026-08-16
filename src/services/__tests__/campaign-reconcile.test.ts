// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  reconcileCampaignProbes,
  type CampaignReconcileResult,
} from '../campaign-reconcile';
import {
  createCampaign,
  listProbes,
  recordProbeVerdict,
  listProbeVerdicts,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  createTodo,
  _closeProject,
} from '../todo-store';
import {
  upsertMission,
  addCriterion,
  setCriterionMet,
  listCriteria,
  _resetMissionDbCache,
} from '../mission-store';
import {
  linkProbeToMission,
  _resetCampaignPassDbCache,
} from '../campaign-pass';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-reconcile-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-reconcile', () => {
  it('advances a failing probe to pass when every linked mission criterion is met', async () => {
    // Create a campaign with a failing probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'test-command' }],
    });
    const probe = listProbes(project, campaign.id)[0];

    // Record the probe as failing.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'sha0',
      evidence: 'initial failure',
    });

    // Create a mission with one criterion and mark it met.
    const missionTodoId = await makeMissionNode('[MISSION] Reconcile test');
    upsertMission(project, missionTodoId);

    const crit = addCriterion(project, missionTodoId, 'src/services/campaign-reconcile.ts advances a probe verdict to pass');
    setCriterionMet(project, crit.id, true);

    // Link the probe to the mission.
    linkProbeToMission(project, probe.id, missionTodoId, campaign.id);

    // Run reconcile.
    const result = await reconcileCampaignProbes(project, campaign.id, {
      commitSha: () => 'sha1',
    });

    // Assertions.
    expect(result.advanced).toContain(probe.id);
    expect(result.unchanged).not.toContain(probe.id);

    // Verify the probe verdict was recorded as pass.
    const updatedProbe = listProbes(project, campaign.id)[0];
    expect(updatedProbe.verdict).toBe('pass');

    // Verify the verdict record was created.
    const verdicts = listProbeVerdicts(project, probe.id);
    const passVerdicts = verdicts.filter((v) => v.verdict === 'pass');
    expect(passVerdicts.length).toBe(1);
    expect(passVerdicts[0].commitSha).toBe('sha1');
  });

  it('leaves a probe unchanged when one linked criterion is unmet', async () => {
    // Create a campaign with a failing probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'test-command' }],
    });
    const probe = listProbes(project, campaign.id)[0];

    // Record the probe as failing.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'sha0',
    });

    // Create a mission with two criteria, mark only one met.
    const missionTodoId = await makeMissionNode('[MISSION] Partial reconcile');
    upsertMission(project, missionTodoId);

    const crit1 = addCriterion(project, missionTodoId, 'src/services/campaign-reconcile.ts handles multiple criteria correctly');
    const crit2 = addCriterion(project, missionTodoId, 'src/services/__tests__/campaign-reconcile.test.ts covers all cases');
    setCriterionMet(project, crit1.id, true);
    setCriterionMet(project, crit2.id, false);

    // Link the probe to the mission.
    linkProbeToMission(project, probe.id, missionTodoId, campaign.id);

    // Run reconcile.
    const result = await reconcileCampaignProbes(project, campaign.id, {
      commitSha: () => 'sha1',
    });

    // Assertions.
    expect(result.unchanged).toContain(probe.id);
    expect(result.advanced).not.toContain(probe.id);

    // Verify the probe is still at fail.
    const updatedProbe = listProbes(project, campaign.id)[0];
    expect(updatedProbe.verdict).toBe('fail');

    // Verify no pass verdict was recorded.
    const verdicts = listProbeVerdicts(project, probe.id);
    const passVerdicts = verdicts.filter((v) => v.verdict === 'pass');
    expect(passVerdicts.length).toBe(0);
  });

  it('leaves a probe unchanged when the linked mission has zero criteria', async () => {
    // Create a campaign with a failing probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'test-command' }],
    });
    const probe = listProbes(project, campaign.id)[0];

    // Record the probe as failing.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'sha0',
    });

    // Create a mission with no criteria.
    const missionTodoId = await makeMissionNode('[MISSION] Empty mission');
    upsertMission(project, missionTodoId);

    // Link the probe to the mission.
    linkProbeToMission(project, probe.id, missionTodoId, campaign.id);

    // Run reconcile.
    const result = await reconcileCampaignProbes(project, campaign.id, {
      commitSha: () => 'sha1',
    });

    // Assertions.
    expect(result.unchanged).toContain(probe.id);
    expect(result.advanced).not.toContain(probe.id);

    // Verify the probe is still at fail.
    const updatedProbe = listProbes(project, campaign.id)[0];
    expect(updatedProbe.verdict).toBe('fail');

    // Verify no pass verdict was recorded.
    const verdicts = listProbeVerdicts(project, probe.id);
    const passVerdicts = verdicts.filter((v) => v.verdict === 'pass');
    expect(passVerdicts.length).toBe(0);
  });

  it('leaves an unlinked probe unchanged', async () => {
    // Create a campaign with a failing probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'test-command' }],
    });
    const probe = listProbes(project, campaign.id)[0];

    // Record the probe as failing.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'sha0',
    });

    // Do NOT link the probe to any mission.

    // Run reconcile.
    const result = await reconcileCampaignProbes(project, campaign.id, {
      commitSha: () => 'sha1',
    });

    // Assertions.
    expect(result.unchanged).toContain(probe.id);
    expect(result.advanced).not.toContain(probe.id);

    // Verify the probe is still at fail.
    const updatedProbe = listProbes(project, campaign.id)[0];
    expect(updatedProbe.verdict).toBe('fail');

    // Verify no pass verdict was recorded.
    const verdicts = listProbeVerdicts(project, probe.id);
    const passVerdicts = verdicts.filter((v) => v.verdict === 'pass');
    expect(passVerdicts.length).toBe(0);
  });
});
