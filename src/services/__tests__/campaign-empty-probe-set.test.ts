// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgeCampaign,
  forgeCampaignFromGoal,
  EmptyCampaignError,
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

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-empty-'));
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

describe('campaign-empty-probe-set', () => {
  it('refuses a campaign forged with zero probes and no goal to derive from', () => {
    const beforeCount = listCampaigns(project).length;

    // Synchronous: forgeCampaign should throw EmptyCampaignError when given
    // a campaign with no probes and no goal.
    expect(() => {
      forgeCampaign(project, { title: 'Empty Campaign' });
    }).toThrow(EmptyCampaignError);

    // Verify the exception has the expected code and name.
    let caughtError: EmptyCampaignError | undefined;
    try {
      forgeCampaign(project, { title: 'Empty Campaign' });
    } catch (err) {
      if (err instanceof EmptyCampaignError) {
        caughtError = err;
      } else {
        throw err;
      }
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.code).toBe('empty-campaign');
    expect(caughtError!.name).toBe('EmptyCampaignError');
    expect(caughtError!.message).toContain('Empty Campaign');

    // Verify no campaign was written.
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('async forgeCampaignFromGoal also rejects when no probes and no goal', async () => {
    const beforeCount = listCampaigns(project).length;

    // Async: forgeCampaignFromGoal should reject with EmptyCampaignError.
    await expect(
      forgeCampaignFromGoal(project, { title: 'Async Empty Campaign' }),
    ).rejects.toThrow(EmptyCampaignError);

    // Verify no campaign was written.
    const afterCount = listCampaigns(project).length;
    expect(afterCount).toBe(beforeCount);
  });
});
