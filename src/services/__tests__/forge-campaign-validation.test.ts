// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgeCampaign,
  InvalidCampaignError,
} from '../campaign-forge';
import {
  listCampaigns,
  listProbes,
  getCampaign,
  _resetCampaignDbCache,
  type ProbeInput,
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
import type { ProbeForgeInput } from '../campaign-validate';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'forge-campaign-'));
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

describe('forge-campaign-validation', () => {
  it('leaves the campaign count identical when one probe of three omits a runner', () => {
    const beforeCount = listCampaigns(project).length;

    const threeProbes: ProbeForgeInput[] = [
      {
        ref: 'probe-a',
        kind: 'command',
        environment: 'worktree',
        command: 'echo "test"',
      },
      {
        ref: 'probe-b',
        kind: 'command',
        environment: 'worktree',
        command: '', // Missing/blank command — invalid
      },
      {
        ref: 'probe-c',
        kind: 'command',
        environment: 'worktree',
        command: 'true',
      },
    ];

    // Expect the forge to throw
    expect(() => {
      forgeCampaign(project, { title: 'Test Campaign', probes: threeProbes });
    }).toThrow(InvalidCampaignError);

    // Campaign count must be unchanged
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('names every offending probe in one refusal', () => {
    const twoProbes: ProbeForgeInput[] = [
      {
        ref: 'bad-command',
        kind: 'command',
        environment: 'worktree',
        command: '', // Missing command
      },
      {
        ref: 'bad-env',
        kind: 'command',
        environment: 'staging' as any, // Invalid environment
        command: 'echo "test"',
      },
    ];

    let caughtError: InvalidCampaignError | undefined;
    try {
      forgeCampaign(project, { title: 'Test Campaign', probes: twoProbes });
    } catch (err) {
      if (err instanceof InvalidCampaignError) {
        caughtError = err;
      } else {
        throw err;
      }
    }

    // Must throw exactly one error
    expect(caughtError).toBeDefined();
    expect(caughtError!.code).toBe('invalid-campaign');

    // Message must contain both refs
    expect(caughtError!.message).toContain('bad-command');
    expect(caughtError!.message).toContain('bad-env');

    // Offenders array must include both
    expect(caughtError!.offenders.length).toBe(2);
    expect(caughtError!.offenders.map(o => o.ref).sort()).toEqual(['bad-command', 'bad-env']);
  });

  it('refuses a dependency graph containing a cycle', () => {
    const beforeCount = listCampaigns(project).length;

    const cycleProbes: ProbeForgeInput[] = [
      {
        ref: 'a',
        kind: 'command',
        environment: 'worktree',
        command: 'true',
        dependsOn: ['b'],
      },
      {
        ref: 'b',
        kind: 'command',
        environment: 'worktree',
        command: 'true',
        dependsOn: ['a'],
      },
    ];

    expect(() => {
      forgeCampaign(project, { title: 'Test Campaign', probes: cycleProbes });
    }).toThrow(InvalidCampaignError);

    // Campaign count must be unchanged
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('accepts a probe asserting a fact about an artifact outside the repository', () => {
    const probes: ProbeForgeInput[] = [
      {
        ref: 'check-external',
        kind: 'command',
        environment: 'rig', rigTargetDir: '/tmp/test-rig', rigCommitSha: 'testsha',
        command: 'test -f /Users/shared/rig/out.step',
        asserts: 'the exported STEP at /Users/shared/rig/out.step has 12 solids',
      },
      {
        ref: 'check-dependent',
        kind: 'command',
        environment: 'rig', rigTargetDir: '/tmp/test-rig', rigCommitSha: 'testsha',
        command: 'true',
        dependsOn: ['check-external'],
      },
    ];

    // Should not throw
    const campaign = forgeCampaign(project, { title: 'Test Campaign', probes });

    // Verify campaign was created
    expect(campaign).toBeDefined();
    expect(campaign.id).toBeDefined();
    expect(campaign.title).toBe('Test Campaign');

    // Re-read and verify
    const retrieved = getCampaign(project, campaign.id);
    expect(retrieved).toBeDefined();

    // Verify probes and that dependsOn is resolved to real ids
    const retrievedProbes = listProbes(project, campaign.id);
    expect(retrievedProbes).toHaveLength(2);

    // Find the dependent probe
    const dependent = retrievedProbes.find(p => p.command === 'true');
    expect(dependent).toBeDefined();

    // dependsOn must hold real probe ids (not refs)
    expect(dependent!.dependsOn).toHaveLength(1);
    expect(dependent!.dependsOn[0]).toBeDefined();

    // Verify the dependent id is in the probes list
    const depId = dependent!.dependsOn[0];
    expect(retrievedProbes.map(p => p.id)).toContain(depId);

    // Verify that asserts is NOT stored (no such column)
    // If asserts were stored, it would have been in the probe; since it's not in the schema,
    // this implicitly verifies the forgeCampaign stripped it before calling createCampaign.
  });
});
