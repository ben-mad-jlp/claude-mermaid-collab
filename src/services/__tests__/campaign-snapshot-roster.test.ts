// Test that listCampaignsForSnapshot carries the chamber roster in every campaign row.
// The snapshot must carry chamberRoster so the UI can render each general's agenda
// description from the server payload instead of hand-typing it in the UI.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAMBER_ROSTER } from '../chamber-constitution.ts';
import { createCampaign, _resetCampaignDbCache } from '../campaign-store.ts';
import { listCampaignsForSnapshot } from '../campaign-snapshot.ts';
import { _closeProject } from '../todo-store.ts';
import { _resetCampaignPassDbCache } from '../campaign-pass.ts';
import { _closeLedgerDb } from '../worker-ledger.ts';
import { _closeAllCollabDbs } from '../collab-db.ts';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-snap-roster-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  process.env.MERMAID_SUPERVISOR_DIR = projectDir;
  _resetCampaignDbCache();
  _closeAllCollabDbs();
});

afterEach(() => {
  _closeProject(projectDir);
  _resetCampaignDbCache(projectDir);
  _resetCampaignPassDbCache(projectDir);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(projectDir, { recursive: true, force: true });
});

describe('listCampaignsForSnapshot chamber roster', () => {
  it('every campaign row carries the chamber roster', () => {
    const campaign = createCampaign(projectDir, {
      title: 'Roster test campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });

    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.chamberRoster).toBeDefined();
    expect(found!.chamberRoster).toHaveLength(CHAMBER_ROSTER.length);

    // Verify each entry matches CHAMBER_ROSTER entry for entry.
    for (let i = 0; i < CHAMBER_ROSTER.length; i++) {
      expect(found!.chamberRoster[i]).toEqual({
        name: CHAMBER_ROSTER[i].name,
        agenda: CHAMBER_ROSTER[i].agenda,
      });
    }
  });
});
