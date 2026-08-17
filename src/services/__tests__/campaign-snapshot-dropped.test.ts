// The bridge snapshot must carry droppedAt: without it the UI renders a retired campaign
// exactly like a live one, and the operator cannot tell which campaign is actually driving
// missions (observed live: two dropped Koch campaigns showed as active next to their
// rig-pinned replacement).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaign, dropCampaign, _resetCampaignDbCache } from '../campaign-store.ts';
import { listCampaignsForSnapshot } from '../campaign-snapshot.ts';
import { _closeAllCollabDbs } from '../collab-db';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-snap-drop-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  _resetCampaignDbCache();
  _closeAllCollabDbs();
});

afterEach(() => {
  _resetCampaignDbCache();
  _closeAllCollabDbs();
  rmSync(projectDir, { recursive: true, force: true });
});

describe('listCampaignsForSnapshot droppedAt', () => {
  it('carries droppedAt for a dropped campaign and null for a live one', () => {
    const live = createCampaign(projectDir, { title: 'live one' });
    const stale = createCampaign(projectDir, { title: 'stale one' });
    const dropped = dropCampaign(projectDir, stale.id);

    const rows = listCampaignsForSnapshot(projectDir);
    const liveRow = rows.find((c) => c.id === live.id);
    const staleRow = rows.find((c) => c.id === stale.id);

    expect(liveRow?.droppedAt).toBeNull();
    expect(staleRow?.droppedAt).toBe(dropped.droppedAt!);
  });
});
