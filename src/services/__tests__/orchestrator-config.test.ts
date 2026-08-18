import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'orch-config-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  ORCH_LEVELS,
  levelRank,
  coalesceLevel,
  getOrchestratorLevel,
  setOrchestratorLevel,
  getProjectPoolSize,
  setProjectPoolSize,
  getProjectInflightCap,
  setProjectInflightCap,
  getProjectPoolConfig,
  getProjectEffort,
  setProjectEffort,
  listNodeProfileOverrides,
  setNodeProfileOverride,
  resolveTierScopedNodeModel,
  copyNodeProfilesTo,
  emitAutoCollapseNotices,
  type CampaignLevel,
  CAMPAIGN_DEFAULT,
  getCampaignLevel,
  setCampaignLevel,
  isCampaignEnabled,
  _closeDb,
} from '../orchestrator-config';
import { listEscalations, _closeDb as supervisorCloseDb } from '../supervisor-store';
import { POOL_CONFIG, POOL_TYPES, MAX_POOL_SIZE } from '../worker-pool';

beforeAll(() => {
  _closeDb();
  supervisorCloseDb();
});
afterAll(() => {
  _closeDb();
  supervisorCloseDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('ORCH_LEVELS', () => {
  it('contains exactly the two canonical levels in order', () => {
    expect(ORCH_LEVELS).toEqual(['off', 'on']);
  });
});

describe('levelRank', () => {
  it('off=0, on=1', () => {
    expect(levelRank('off')).toBe(0);
    expect(levelRank('on')).toBe(1);
  });

  it('ranks are strictly ordered (off < on)', () => {
    for (let i = 0; i < ORCH_LEVELS.length - 1; i++) {
      expect(levelRank(ORCH_LEVELS[i])).toBeLessThan(levelRank(ORCH_LEVELS[i + 1]));
    }
  });
});

describe('coalesceLevel — legacy 5-rung → off|on', () => {
  it('collapses auto, build, nudge, propose, drive → on; off → off', () => {
    expect(coalesceLevel('off')).toBe('off');
    expect(coalesceLevel('on')).toBe('on');
    expect(coalesceLevel('auto')).toBe('on');
    expect(coalesceLevel('build')).toBe('on');
    expect(coalesceLevel('nudge')).toBe('on');
    expect(coalesceLevel('propose')).toBe('on');
    expect(coalesceLevel('drive')).toBe('on');
  });
  it('unknown / undefined → on (supervised default)', () => {
    expect(coalesceLevel('totally-unknown')).toBe('on');
    expect(coalesceLevel(undefined)).toBe('on');
  });
});

describe('getOrchestratorLevel default', () => {
  it('returns "on" for an unregistered project', () => {
    expect(getOrchestratorLevel('/never/registered')).toBe('on');
  });
});

describe('set → get round-trip', () => {
  it('persists each canonical level correctly', () => {
    for (const level of ORCH_LEVELS) {
      const project = `/proj/${level}`;
      setOrchestratorLevel(project, level);
      expect(getOrchestratorLevel(project)).toBe(level);
    }
  });

  it('updates an existing row', () => {
    const project = '/proj/update-test';
    setOrchestratorLevel(project, 'off');
    expect(getOrchestratorLevel(project)).toBe('off');
    setOrchestratorLevel(project, 'on');
    expect(getOrchestratorLevel(project)).toBe('on');
  });
});

describe('legacy read coalescing', () => {
  it('a row persisted as a legacy value reads back coalesced to on|off', () => {
    // getOrchestratorLevel coalesces on read even if a legacy value lingers
    // (the backfill collapses stored rows; this guards the read seam too).
    setOrchestratorLevel('/proj/legacy', 'drive' as never);
    expect(getOrchestratorLevel('/proj/legacy')).toBe('on');
    setOrchestratorLevel('/proj/legacy2', 'build' as never);
    expect(getOrchestratorLevel('/proj/legacy2')).toBe('on');
  });
});

describe('unknown value clamping', () => {
  it('setOrchestratorLevel clamps unknown values to "on"', () => {
    setOrchestratorLevel('/proj/bad', 'totally-unknown' as never);
    expect(getOrchestratorLevel('/proj/bad')).toBe('on');
  });
});

describe('per-project in-flight cap', () => {
  it('returns null when unset', () => {
    expect(getProjectInflightCap('/proj/cap-unset')).toBeNull();
  });

  it('set/get round-trips', () => {
    setProjectInflightCap('/proj/cap-a', 7);
    expect(getProjectInflightCap('/proj/cap-a')).toBe(7);
  });

  it('clamps to [1, 32]', () => {
    setProjectInflightCap('/proj/cap-hi', 999);
    expect(getProjectInflightCap('/proj/cap-hi')).toBe(32);
    setProjectInflightCap('/proj/cap-lo', 0);
    expect(getProjectInflightCap('/proj/cap-lo')).toBe(1);
  });

  it('null clears the override', () => {
    setProjectInflightCap('/proj/cap-clear', 5);
    expect(getProjectInflightCap('/proj/cap-clear')).toBe(5);
    setProjectInflightCap('/proj/cap-clear', null);
    expect(getProjectInflightCap('/proj/cap-clear')).toBeNull();
  });

  it('is independent of poolSize on the same project row', () => {
    setProjectPoolSize('/proj/cap-mix', 4);
    setProjectInflightCap('/proj/cap-mix', 9);
    expect(getProjectPoolSize('/proj/cap-mix')).toBe(4);
    expect(getProjectInflightCap('/proj/cap-mix')).toBe(9);
  });
});

describe('per-project pool size', () => {
  it('returns null when unset → getProjectPoolConfig falls back to the global default', () => {
    expect(getProjectPoolSize('/proj/pool-unset')).toBeNull();
    expect(getProjectPoolConfig('/proj/pool-unset')).toEqual(POOL_CONFIG);
  });

  it('set/get round-trips and expands to a uniform per-type config', () => {
    setProjectPoolSize('/proj/pool-a', 6);
    expect(getProjectPoolSize('/proj/pool-a')).toBe(6);
    const cfg = getProjectPoolConfig('/proj/pool-a');
    for (const t of POOL_TYPES) expect(cfg[t]).toBe(6);
  });

  it('clamps to [1, MAX_POOL_SIZE]', () => {
    setProjectPoolSize('/proj/pool-hi', 999);
    expect(getProjectPoolSize('/proj/pool-hi')).toBe(MAX_POOL_SIZE);
    setProjectPoolSize('/proj/pool-lo', 0);
    expect(getProjectPoolSize('/proj/pool-lo')).toBe(1);
  });

  it('null clears the override (reverts to global default)', () => {
    setProjectPoolSize('/proj/pool-clear', 8);
    expect(getProjectPoolSize('/proj/pool-clear')).toBe(8);
    setProjectPoolSize('/proj/pool-clear', null);
    expect(getProjectPoolSize('/proj/pool-clear')).toBeNull();
    expect(getProjectPoolConfig('/proj/pool-clear')).toEqual(POOL_CONFIG);
  });

  it('setting pool size on a fresh project leaves its level at the on default', () => {
    setProjectPoolSize('/proj/pool-level', 4);
    expect(getOrchestratorLevel('/proj/pool-level')).toBe('on');
  });
});

describe('per-project effort override', () => {
  it('returns null (auto) when unset', () => {
    expect(getProjectEffort('/proj/eff-unset')).toBeNull();
  });

  it('set/get round-trips a valid level', () => {
    setProjectEffort('/proj/eff-a', 'xhigh');
    expect(getProjectEffort('/proj/eff-a')).toBe('xhigh');
  });

  it('an invalid level coerces to null (auto)', () => {
    setProjectEffort('/proj/eff-bad', 'turbo' as never);
    expect(getProjectEffort('/proj/eff-bad')).toBeNull();
  });

  it('null clears the override', () => {
    setProjectEffort('/proj/eff-clear', 'high');
    expect(getProjectEffort('/proj/eff-clear')).toBe('high');
    setProjectEffort('/proj/eff-clear', null);
    expect(getProjectEffort('/proj/eff-clear')).toBeNull();
  });
});

describe('per-(project,node-kind) model + effort overrides', () => {
  it('absent kinds return no override; set/list round-trips', () => {
    expect(listNodeProfileOverrides('/proj/np-a')).toEqual({});
    setNodeProfileOverride('/proj/np-a', 'blueprint', 'sonnet', 'max');
    const o = listNodeProfileOverrides('/proj/np-a');
    expect(o.blueprint).toEqual({ model: 'sonnet', effort: 'max', provider: null });
  });

  it('null model/effort clears that field; both null removes the row', () => {
    setNodeProfileOverride('/proj/np-b', 'review', 'opus', 'xhigh');
    setNodeProfileOverride('/proj/np-b', 'review', null, 'high'); // clear model only
    expect(listNodeProfileOverrides('/proj/np-b').review).toEqual({ model: null, effort: 'high', provider: null });
    setNodeProfileOverride('/proj/np-b', 'review', null, null); // remove row
    expect(listNodeProfileOverrides('/proj/np-b').review).toBeUndefined();
  });

  it('an invalid effort coerces to null', () => {
    setNodeProfileOverride('/proj/np-c', 'implement', 'haiku', 'turbo' as never);
    expect(listNodeProfileOverrides('/proj/np-c').implement).toEqual({ model: 'haiku', effort: null, provider: null });
  });
});

describe('resolveTierScopedNodeModel', () => {
  it('tier-scoped row beats the kind-wide row; kind-wide beats nothing', () => {
    const overrides = {
      'implement@small': { model: 'haiku', effort: null, provider: null },
      'implement': { model: 'sonnet', effort: null, provider: null },
    };

    // tier-scoped wins for small tier
    expect(resolveTierScopedNodeModel(overrides, 'implement', 'small')).toBe('haiku');

    // kind-wide applies when no tier row
    expect(resolveTierScopedNodeModel(overrides, 'implement', 'full')).toBe('sonnet');

    // unknown kind returns null
    expect(resolveTierScopedNodeModel(overrides, 'review', 'small')).toBeNull();
  });

  it('null/undefined tier ignores tier-scoped rows and falls through to kind-wide', () => {
    const overrides = {
      'implement@small': { model: 'haiku', effort: null, provider: null },
      'implement': { model: 'sonnet', effort: null, provider: null },
    };

    // null tier ignores tier row, uses kind-wide
    expect(resolveTierScopedNodeModel(overrides, 'implement', null)).toBe('sonnet');

    // undefined tier ignores tier row, uses kind-wide
    expect(resolveTierScopedNodeModel(overrides, 'implement', undefined)).toBe('sonnet');
  });

  it('a tier row with null model falls through to kind-wide row', () => {
    const overrides = {
      'review@small': { model: null, effort: null, provider: null },
      'review': { model: 'opus', effort: null, provider: null },
    };

    expect(resolveTierScopedNodeModel(overrides, 'review', 'small')).toBe('opus');
  });

  it('an empty-string model coalesces to null (inherit)', () => {
    const overrides = {
      'blueprint': { model: '', effort: null, provider: null },
    };

    expect(resolveTierScopedNodeModel(overrides, 'blueprint', 'full')).toBeNull();
  });

  it('an unknown kind with no tier returns null', () => {
    const overrides = {
      'implement': { model: 'sonnet', effort: null, provider: null },
    };

    expect(resolveTierScopedNodeModel(overrides, 'unknown-kind', 'small')).toBeNull();
    expect(resolveTierScopedNodeModel(overrides, 'unknown-kind', null)).toBeNull();
  });
});

describe('auto-collapse notices', () => {
  it('coalesceLevel maps auto to on', () => {
    // Verify that the coalesce function maps all legacy levels to on.
    expect(coalesceLevel('auto')).toBe('on');
    expect(coalesceLevel('drive')).toBe('on');
    expect(coalesceLevel('build')).toBe('on');
  });

  it('a stored auto row folds to on and emits a one-time escalation notice', () => {
    const project = '/proj/auto-collapse-test';

    // Manually insert an 'auto' row before triggering the migration.
    // This simulates a scenario where an auto row already exists in the database
    // (e.g., from a previous deployment).
    _closeDb();
    const dbPath = join(process.env.MERMAID_SUPERVISOR_DIR!, 'supervisor.db');
    const manualDb = new Database(dbPath);
    manualDb.prepare(
      'INSERT OR REPLACE INTO orchestrator_config (project, level, updatedAt) VALUES (?, ?, ?)'
    ).run(project, 'auto', Date.now());
    manualDb.close();

    // Verify before emitting: no escalations yet
    const beforeEscalations = listEscalations().filter(e => e.kind === 'orchestrator-level-collapse' && e.project === project);
    expect(beforeEscalations.length).toBe(0);

    // Emit notices: triggers openDb() which runs the migration, captures the auto
    // project into the notice table, folds it to 'on', and emits the escalation.
    emitAutoCollapseNotices();

    // Verify escalation was created
    const afterFirstCall = listEscalations().filter(e => e.kind === 'orchestrator-level-collapse' && e.project === project);
    expect(afterFirstCall.length).toBe(1);
    expect(afterFirstCall[0].questionText).toContain('Autonomy collapsed to off/on');

    // Verify the row is now 'on' (not 'auto')
    expect(getOrchestratorLevel(project)).toBe('on');

    // Second call should dedupe via the notified flag.
    emitAutoCollapseNotices();

    const afterSecondCall = listEscalations().filter(e => e.kind === 'orchestrator-level-collapse' && e.project === project);
    expect(afterSecondCall.length).toBe(1); // still only one, not two
  });
});

describe('copyNodeProfilesTo (push to all projects)', () => {
  it('merges source kinds into each target, preserving target pins', () => {
    setNodeProfileOverride('/proj/merge-src', 'blueprint', 'sonnet', 'max');
    setNodeProfileOverride('/proj/merge-src', 'review', null, 'high');
    setNodeProfileOverride('/proj/merge-dst', 'implement', 'haiku', 'low'); // pre-existing → preserved
    const result = copyNodeProfilesTo('/proj/merge-src', ['/proj/merge-src', '/proj/merge-dst', '/proj/merge-dst2']);
    expect(result.applied).toBe(2); // source skipped

    // /proj/merge-dst should have source kinds (blueprint, review) + its own pin (implement)
    const dstProfiles = listNodeProfileOverrides('/proj/merge-dst');
    expect(dstProfiles.blueprint).toEqual({ model: 'sonnet', effort: 'max', provider: null });
    expect(dstProfiles.review).toEqual({ model: null, effort: 'high', provider: null });
    expect(dstProfiles.implement).toEqual({ model: 'haiku', effort: 'low', provider: null }); // preserved

    // /proj/merge-dst2 should have only source kinds
    const dst2Profiles = listNodeProfileOverrides('/proj/merge-dst2');
    expect(dst2Profiles).toEqual({
      blueprint: { model: 'sonnet', effort: 'max', provider: null },
      review: { model: null, effort: 'high', provider: null },
    });

    // Source should be untouched
    expect(listNodeProfileOverrides('/proj/merge-src')).toEqual({
      blueprint: { model: 'sonnet', effort: 'max', provider: null },
      review: { model: null, effort: 'high', provider: null },
    });

    // Preserved should report that /proj/merge-dst kept implement
    expect(result.preserved).toContainEqual({ project: '/proj/merge-dst', kinds: ['implement'] });
    expect(result.overwritten).toEqual([]); // no overwrites in default path
  });

  it('a per-project operator pin survives a global profile push', () => {
    setNodeProfileOverride('/proj/pin-src', 'blueprint', 'sonnet', 'max');
    setNodeProfileOverride('/proj/pin-src', 'review', 'opus', 'high');
    setNodeProfileOverride('/proj/pin-dst', 'implement', 'haiku', 'low'); // local pin

    const result = copyNodeProfilesTo('/proj/pin-src', ['/proj/pin-src', '/proj/pin-dst', '/proj/pin-dst2']);

    // /proj/pin-dst's implement pin should survive
    const dstImplement = listNodeProfileOverrides('/proj/pin-dst').implement;
    expect(dstImplement).toEqual({ model: 'haiku', effort: 'low', provider: null });

    // Preserved should report it
    expect(result.preserved).toContainEqual({ project: '/proj/pin-dst', kinds: ['implement'] });
  });

  it('force overwrites a per-project pin and reports it', () => {
    setNodeProfileOverride('/proj/force-src', 'blueprint', 'sonnet', 'max');
    setNodeProfileOverride('/proj/force-src', 'review', 'opus', 'high');
    setNodeProfileOverride('/proj/force-dst', 'implement', 'haiku', 'low'); // local pin

    const result = copyNodeProfilesTo('/proj/force-src', ['/proj/force-dst'], { force: true });

    // /proj/force-dst should now have ONLY source kinds (implement wiped)
    const dstProfiles = listNodeProfileOverrides('/proj/force-dst');
    expect(dstProfiles).toEqual({
      blueprint: { model: 'sonnet', effort: 'max', provider: null },
      review: { model: 'opus', effort: 'high', provider: null },
    });
    expect(dstProfiles.implement).toBeUndefined(); // wiped

    // Overwritten should report it
    expect(result.overwritten).toContainEqual({ project: '/proj/force-dst', kinds: ['implement'] });
    expect(result.preserved).toEqual([]); // nothing preserved in force mode
  });
});

describe('per-project campaign switch', () => {
  it('an unset project reads back CAMPAIGN_DEFAULT', () => {
    expect(getCampaignLevel('/proj/campaign-unset')).toBe(CAMPAIGN_DEFAULT);
  });

  it('a legacy row with campaignLevel NULL reads back CAMPAIGN_DEFAULT, not off', () => {
    // Simulate a legacy row created before the campaignLevel column existed
    // (NULL campaignLevel, but with the orchestrator level set via setOrchestratorLevel)
    _closeDb();
    const dbPath = join(process.env.MERMAID_SUPERVISOR_DIR!, 'supervisor.db');
    const manualDb = new Database(dbPath);
    manualDb.prepare(
      'INSERT OR REPLACE INTO orchestrator_config (project, level, updatedAt) VALUES (?, ?, ?)'
    ).run('/proj/campaign-legacy', 'on', Date.now());
    manualDb.close();

    // Verify the row reads back with the default (not 'off')
    expect(getCampaignLevel('/proj/campaign-legacy')).toBe(CAMPAIGN_DEFAULT);
  });

  it('setCampaignLevel off round-trips and isCampaignEnabled returns false', () => {
    const project = '/proj/campaign-off-test';
    setCampaignLevel(project, 'off');
    expect(getCampaignLevel(project)).toBe('off');
    expect(isCampaignEnabled(project)).toBe(false);
  });

  it('an unrecognised value clamps to CAMPAIGN_DEFAULT rather than off', () => {
    const project = '/proj/campaign-unknown';
    setCampaignLevel(project, 'bogus' as CampaignLevel);
    expect(getCampaignLevel(project)).toBe(CAMPAIGN_DEFAULT);
    expect(isCampaignEnabled(project)).toBe(true);
  });
});
