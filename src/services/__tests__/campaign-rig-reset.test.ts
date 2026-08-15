// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
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
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { canonicalProjectRoot } from '../store-paths';
import {
  runRigReset,
  getRigResetRecord,
  listRigResetRecords,
  _resetRigResetDbCache,
  type RigResetDeps,
  type OpenedProject,
} from '../campaign-rig-reset';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-rig-reset-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetRigResetDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-rig-reset', () => {
  it('accepts rig as a probe environment', () => {
    // Create a campaign with one probe using 'rig' environment.
    const campaign = createCampaign(project, {
      title: 'Rig Test Campaign',
      probes: [
        { kind: 'command', environment: 'rig', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(1);
    const probe = probes[0];

    // Verify the probe has 'rig' environment.
    expect(probe.environment).toBe('rig');

    // Record a verdict with 'rig' environment.
    const verdict = recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'rig123sha456',
    });

    // Verify the verdict row has 'rig' environment.
    expect(verdict.environment).toBe('rig');
    expect(verdict.verdict).toBe('pass');

    // Read back via listProbeVerdicts.
    const verdicts = listProbeVerdicts(project, probe.id);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].environment).toBe('rig');
    expect(verdicts[0].verdict).toBe('pass');

    // Verify that campaign_probe.verdict was updated.
    const updatedProbes = listProbes(project, campaign.id);
    expect(updatedProbes[0].verdict).toBe('pass');
  });

  it('migrates a pre-existing narrow-CHECK database to accept rig', () => {
    // Create a database with the OLD narrow CHECK clauses and seed rows.
    const collabDir = join(canonicalProjectRoot(project), '.collab');
    mkdirSync(collabDir, { recursive: true });
    const collabDbPath = join(collabDir, 'collab.db');

    // Open the database directly and seed it with the OLD schema.
    const seedDb = new Database(collabDbPath);
    try {
      // Create campaign table.
      seedDb.exec(`
        CREATE TABLE IF NOT EXISTS campaign (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          title TEXT NOT NULL,
          createdAt INTEGER NOT NULL
        )
      `);

      // Create campaign_probe with NARROW check (only 'worktree').
      seedDb.exec(`
        CREATE TABLE IF NOT EXISTS campaign_probe (
          id TEXT PRIMARY KEY,
          campaignId TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('command')),
          environment TEXT NOT NULL CHECK (environment IN ('worktree')),
          dependsOn TEXT NOT NULL DEFAULT '[]',
          verdict TEXT NOT NULL DEFAULT 'not-run' CHECK (verdict IN ('not-run', 'pass', 'fail')),
          command TEXT,
          createdAt INTEGER NOT NULL
        )
      `);
      seedDb.exec('CREATE INDEX IF NOT EXISTS idx_campaign_probe_campaign ON campaign_probe(campaignId)');

      // Create campaign_probe_verdict with NARROW check (only 'worktree').
      seedDb.exec(`
        CREATE TABLE IF NOT EXISTS campaign_probe_verdict (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          probeId TEXT NOT NULL REFERENCES campaign_probe(id) ON DELETE CASCADE,
          verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail')),
          environment TEXT NOT NULL CHECK (environment IN ('worktree')),
          commitSha TEXT NOT NULL,
          evidence TEXT,
          recordedAt INTEGER NOT NULL
        )
      `);
      seedDb.exec('CREATE INDEX IF NOT EXISTS idx_campaign_probe_verdict_probe ON campaign_probe_verdict(probeId)');

      // Seed: insert a campaign, probe, and verdict.
      const campaignId = 'test-campaign-1';
      const probeId = 'test-probe-1';
      const verdictId = 1;

      seedDb.prepare('INSERT INTO campaign (id, project, title, createdAt) VALUES (?, ?, ?, ?)')
        .run(campaignId, project, 'Seeded Campaign', 1000);

      seedDb.prepare('INSERT INTO campaign_probe (id, campaignId, kind, environment, dependsOn, verdict, command, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(probeId, campaignId, 'command', 'worktree', '[]', 'pass', 'true', 1001);

      seedDb.prepare('INSERT INTO campaign_probe_verdict (id, probeId, verdict, environment, commitSha, evidence, recordedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(verdictId, probeId, 'pass', 'worktree', 'abc123', 'Test evidence', 1002);

      seedDb.close();
    } catch (err) {
      seedDb.close();
      throw err;
    }

    // Reset the campaign cache so the next open triggers the migration.
    _resetCampaignDbCache(project);

    // Now open via createCampaign, which calls openCampaignDb and triggers the migration.
    const campaign = createCampaign(project, {
      title: 'Post-Migration Campaign',
      probes: [
        { kind: 'command', environment: 'rig', command: 'false' },
      ],
    });

    expect(campaign).toBeDefined();
    expect(campaign.title).toBe('Post-Migration Campaign');

    // Verify the migrated rows are still there.
    const verdicts = listProbeVerdicts(project, 'test-probe-1');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].environment).toBe('worktree');
    expect(verdicts[0].verdict).toBe('pass');
    expect(verdicts[0].commitSha).toBe('abc123');

    // Verify that we can now insert a 'rig' probe and verdict (would have failed before migration).
    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(1);
    const rigProbe = probes[0];
    expect(rigProbe.environment).toBe('rig');

    const rigVerdict = recordProbeVerdict(project, {
      probeId: rigProbe.id,
      verdict: 'fail',
      environment: 'rig',
      commitSha: 'rig456sha789',
    });

    expect(rigVerdict.environment).toBe('rig');
    expect(rigVerdict.verdict).toBe('fail');
  });

  it('restores the target directory to the named commit before a rig probe runs', async () => {
    // Create a campaign with one rig probe.
    const campaign = createCampaign(project, {
      title: 'Rig Reset Order Test',
      probes: [
        { kind: 'command', environment: 'rig', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const probe = probes[0];

    // Create a shared spy array to track call order.
    const calls: string[] = [];

    // Create mock deps that track invocation order.
    const deps: RigResetDeps = {
      restoreToCommit: async (targetDir: string, commitSha: string) => {
        calls.push('restoreToCommit');
        expect(targetDir).toBe('/fake/target');
        expect(commitSha).toBe('abc123def456');
      },
      startApp: async (targetDir: string) => {
        calls.push('startApp');
        expect(targetDir).toBe('/fake/target');
        return {} as any;
      },
      openProject: async (handle: any, targetDir: string) => {
        calls.push('openProject');
        expect(targetDir).toBe('/fake/target');
        return { members: ['file1.txt', 'file2.txt'] };
      },
      readManifestCount: async (targetDir: string) => {
        calls.push('readManifestCount');
        expect(targetDir).toBe('/fake/target');
        return 2;
      },
      now: () => 1000,
    };

    // Run the rig reset.
    await runRigReset(project, probe.id, {
      targetDir: '/fake/target',
      commitSha: 'abc123def456',
    }, deps);

    // Verify the order of calls.
    expect(calls).toEqual([
      'restoreToCommit',
      'startApp',
      'openProject',
      'readManifestCount',
    ]);
    expect(calls.indexOf('restoreToCommit')).toBeLessThan(calls.indexOf('startApp'));
    expect(calls.indexOf('startApp')).toBeLessThan(calls.indexOf('openProject'));
  });

  it('records both the opened member count and the manifest count on the reset record', async () => {
    // Create a campaign with one rig probe.
    const campaign = createCampaign(project, {
      title: 'Rig Reset Counts Test',
      probes: [
        { kind: 'command', environment: 'rig', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const probe = probes[0];

    // Create deps that return specific counts (deliberately unequal).
    const deps: RigResetDeps = {
      restoreToCommit: async () => {},
      startApp: async () => ({} as any),
      openProject: async (): Promise<OpenedProject> => ({
        members: ['a.txt', 'b.txt', 'c.txt'], // 3 members
      }),
      readManifestCount: async () => 5, // 5 in manifest
      now: () => 2000,
    };

    // Run the rig reset.
    const record = await runRigReset(project, probe.id, {
      targetDir: '/fake/target',
      commitSha: 'xyz789abc123',
    }, deps);

    // Verify the record has both distinct counts.
    expect(record.openedMemberCount).toBe(3);
    expect(record.manifestCount).toBe(5);
    expect(record.probeId).toBe(probe.id);
    expect(record.commitSha).toBe('xyz789abc123');
    expect(record.resetAt).toBe(2000);

    // Verify we can read it back via getRigResetRecord.
    const retrieved = getRigResetRecord(project, probe.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.openedMemberCount).toBe(3);
    expect(retrieved!.manifestCount).toBe(5);

    // Verify listRigResetRecords includes it.
    const records = listRigResetRecords(project, probe.id);
    expect(records).toHaveLength(1);
    expect(records[0].openedMemberCount).toBe(3);
    expect(records[0].manifestCount).toBe(5);
  });
});
