// A campaign database created BEFORE the two-round deliberation work has a
// campaign_completion_lens table with no `round` column. CREATE TABLE IF NOT EXISTS leaves
// that table alone, so any index declared over `round` inside CAMPAIGN_SCHEMA throws
// "no such column: round" and takes EVERY campaign verb for that project down with it.
// Observed live on build123d-ocp-mcp, the first real campaign's own project.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openCampaignDb, _resetCampaignDbCache } from '../campaign-store';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'legacy-lens-'));
  mkdirSync(join(project, '.collab'), { recursive: true });
  // Seed the LEGACY shape: lens table without round/changedVerdict.
  const seed = new Database(join(project, '.collab', 'collab.db'));
  seed.exec(`CREATE TABLE campaign_completion_verdict (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaignId TEXT NOT NULL, judge TEXT NOT NULL, verdict TEXT NOT NULL,
    ruledAtSha TEXT NOT NULL, rationale TEXT, ruledAt INTEGER NOT NULL)`);
  seed.exec(`CREATE TABLE campaign_completion_lens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    completionId INTEGER NOT NULL,
    lens TEXT NOT NULL, verdict TEXT NOT NULL, reasoning TEXT, recordedAt INTEGER NOT NULL)`);
  seed.close();
  _resetCampaignDbCache();
  _closeAllCollabDbs();
});

afterEach(() => {
  _resetCampaignDbCache();
  _closeAllCollabDbs();
  rmSync(project, { recursive: true, force: true });
});

describe('campaign store opens a pre-round-column database', () => {
  it('migrates a legacy campaign_completion_lens table instead of throwing on an index over a missing column', () => {
    expect(() => openCampaignDb(project)).not.toThrow();

    const db = openCampaignDb(project);
    const cols = (db.prepare('PRAGMA table_info(campaign_completion_lens)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols).toContain('round');
    expect(cols).toContain('changedVerdict');
  });
});
