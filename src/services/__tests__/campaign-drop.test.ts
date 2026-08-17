// drop_campaign — a dropped campaign stops driving work but never disappears.
//
// The campaign pass iterates EVERY campaign of a project (campaign-scheduling.ts), and
// before dropCampaign existed there was no way to retire one: two stale campaigns kept
// spawning missions against the same physical repo as their replacement, corrupting each
// other's rig state. These tests pin the three load-bearing behaviours: the drop persists
// and is idempotent, the scheduler skips dropped campaigns, and a legacy DB (created
// before the droppedAt column) migrates cleanly.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  dropCampaign,
  _resetCampaignDbCache,
} from '../campaign-store.ts';
import { runCampaignPassForProject } from '../campaign-scheduling.ts';
import { _closeAllCollabDbs } from '../collab-db';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-drop-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  _resetCampaignDbCache();
  _closeAllCollabDbs();
});

afterEach(() => {
  _resetCampaignDbCache();
  _closeAllCollabDbs();
  rmSync(projectDir, { recursive: true, force: true });
});

describe('dropCampaign', () => {
  it('sets droppedAt, keeps the row readable, and is idempotent with the ORIGINAL timestamp', () => {
    const campaign = createCampaign(projectDir, { title: 'stale one' });
    expect(campaign.droppedAt).toBeNull();

    const dropped = dropCampaign(projectDir, campaign.id);
    expect(dropped.droppedAt).not.toBeNull();

    // Still readable — a drop hides work from the machinery, never from the operator.
    const read = getCampaign(projectDir, campaign.id);
    expect(read?.droppedAt).toBe(dropped.droppedAt);
    expect(listCampaigns(projectDir).map((c) => c.id)).toContain(campaign.id);

    // Idempotent: second drop keeps the first timestamp.
    const again = dropCampaign(projectDir, campaign.id);
    expect(again.droppedAt).toBe(dropped.droppedAt);
  });

  it('throws on an unknown campaign id', () => {
    createCampaign(projectDir, { title: 'present' });
    expect(() => dropCampaign(projectDir, 'no-such-campaign')).toThrow(/unknown campaign/);
  });

  it('the scheduler runs NO pass for a dropped campaign', async () => {
    const live = createCampaign(projectDir, { title: 'live' });
    const stale = createCampaign(projectDir, { title: 'stale' });
    dropCampaign(projectDir, stale.id);

    const passed: string[] = [];
    const result = await runCampaignPassForProject(projectDir, {
      deps: {
        runCampaignPass: (async (_p: string, campaignId: string) => {
          passed.push(campaignId);
          return { forged: [], skipped: [] } as any;
        }) as any,
      },
    });

    expect(passed).toEqual([live.id]);
    expect(result.campaigns).toEqual([live.id]);
  });

  it('migrates a legacy campaign table that predates droppedAt', () => {
    // Seed the OLD shape directly — fresh-DB suites cannot catch legacy-schema bugs.
    const dbPath = join(projectDir, '.collab', 'collab.db');
    const raw = new Database(dbPath);
    raw.exec(`CREATE TABLE campaign (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT,
      createdAt INTEGER NOT NULL
    );`);
    raw.prepare('INSERT INTO campaign (id, project, title, goal, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('legacy-1', projectDir, 'from before the column', null, 1);
    raw.close();
    _resetCampaignDbCache();
    _closeAllCollabDbs();

    // Opening through the store must add the column, read the legacy row as not-dropped,
    // and allow dropping it. getCampaign (by id) avoids the canonical-root project filter,
    // which may not match the raw path the seed row carries.
    const legacy = getCampaign(projectDir, 'legacy-1');
    expect(legacy).not.toBeNull();
    expect(legacy?.droppedAt).toBeNull();

    const dropped = dropCampaign(projectDir, 'legacy-1');
    expect(dropped.droppedAt).not.toBeNull();
  });
});
