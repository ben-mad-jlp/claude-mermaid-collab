/**
 * AutoFix — the third per-project operator lever (beside the daemon's orchestrator level
 * and the conductor toggle).
 *
 * It gates exactly ONE thing: the daemon's repair-forge pass (runRepairForgePass), the
 * only pass that spends nodes without a human asking. Findings/friction recording is
 * deliberately NOT gated.
 *
 * The load-bearing claim here is the && ORDERING at the dispatch site:
 *   watched.has(project) && isAutoFixEnabled(project) && shouldRunRepairForge(project)
 * `shouldRunRepairForgePass` is NOT pure — it stamps the per-project throttle clock as a
 * side effect. Evaluating it before the AutoFix check would burn that 5-minute clock on
 * every tick while AutoFix is off, so flipping the switch back on would leave the forge
 * silently rate-limited. The ordering test below pins that.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the global stores BEFORE the modules open them.
const supDir = mkdtempSync(join(tmpdir(), 'autofix-sup-'));
const dataDir = mkdtempSync(join(tmpdir(), 'autofix-data-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;
process.env.MERMAID_DATA_DIR = dataDir;

import {
  AUTOFIX_LEVELS,
  AUTOFIX_DEFAULT,
  getAutoFixLevel,
  setAutoFixLevel,
  isAutoFixEnabled,
  _closeDb as orchestratorConfigCloseDb,
} from '../orchestrator-config';
import { runOrchestratorTick, type TickDeps } from '../orchestrator-live';
import { shouldRunRepairForgePass, _resetRepairForgeThrottle } from '../repair-mission-pass';
import { _closeDb as supervisorCloseDb } from '../supervisor-store';
import { _closeLedgerDb } from '../worker-ledger';

/** A NON-transient project path. orchestrator-config refuses durable writes for /tmp and
 *  worktree-lane paths, so the persistence tests must key off a real-looking repo path
 *  (the row is just a key — the directory need not exist). */
function realProjectPath(tag: string): string {
  return `/Users/benmaderazo/Code/claude-mermaid-collab-autofix-${tag}-${Math.random().toString(36).slice(2)}`;
}

const todoBase = mkdtempSync(join(tmpdir(), 'autofix-proj-'));
let projectCounter = 0;
function freshTickProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { supervisorCloseDb(); orchestratorConfigCloseDb(); });
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  process.env.MERMAID_DATA_DIR = dataDir;
});
afterAll(() => {
  supervisorCloseDb();
  orchestratorConfigCloseDb();
  _closeLedgerDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_DATA_DIR;
});

describe('AutoFix level store', () => {
  it('exposes exactly the two stops, defaulting to on', () => {
    expect(AUTOFIX_LEVELS).toEqual(['off', 'on']);
    expect(AUTOFIX_DEFAULT).toBe('on');
  });

  it('DEFAULTS TO ON for a project with no stored row (the forge runs today — opt-out only)', () => {
    const project = realProjectPath('unset');
    expect(getAutoFixLevel(project)).toBe('on');
    expect(isAutoFixEnabled(project)).toBe(true);
  });

  it('a LEGACY row written without the autoFixLevel column reads back as the default', () => {
    // Force the schema into existence, then write a row the way a pre-AutoFix build did:
    // level only, autoFixLevel absent (NULL). No migration step may be required to read it.
    const seeded = realProjectPath('schema-init');
    setAutoFixLevel(seeded, 'on');
    const legacy = realProjectPath('legacy');
    const raw = new Database(join(supDir, 'supervisor.db'));
    try {
      raw.prepare('INSERT INTO orchestrator_config (project, level, updatedAt) VALUES (?, ?, ?)')
        .run(legacy, 'on', Date.now());
      const row = raw.query('SELECT autoFixLevel FROM orchestrator_config WHERE project = ?')
        .get(legacy) as { autoFixLevel: string | null };
      expect(row.autoFixLevel).toBeNull(); // non-vacuous: the column really is unset
    } finally {
      raw.close();
    }
    expect(getAutoFixLevel(legacy)).toBe('on');
    expect(isAutoFixEnabled(legacy)).toBe(true);
  });

  it('setting off then reading returns off; setting on returns on', () => {
    const project = realProjectPath('roundtrip');
    setAutoFixLevel(project, 'off');
    expect(getAutoFixLevel(project)).toBe('off');
    expect(isAutoFixEnabled(project)).toBe(false);

    setAutoFixLevel(project, 'on');
    expect(getAutoFixLevel(project)).toBe('on');
    expect(isAutoFixEnabled(project)).toBe(true);
  });

  it('preserves the daemon level it shares a row with', () => {
    const project = realProjectPath('coexist');
    setAutoFixLevel(project, 'off');
    const raw = new Database(join(supDir, 'supervisor.db'));
    try {
      const row = raw.query('SELECT level, autoFixLevel FROM orchestrator_config WHERE project = ?')
        .get(project) as { level: string; autoFixLevel: string };
      expect(row.level).toBe('on');
      expect(row.autoFixLevel).toBe('off');
    } finally {
      raw.close();
    }
  });
});

describe('AutoFix gate at the orchestrator tick dispatch site', () => {
  function baseDeps(project: string): TickDeps {
    return {
      listProjects: async () => [{ path: project }],
      watchedProjects: () => new Set([project]),
      getLevel: () => 'off', // build/reconcile/archival lanes out of scope here
      listConfigured: () => [],
      setLevel: () => {},
      dirExists: () => true,
      shouldRunNotify: () => false,
      shouldRunMissionLoop: () => false,
      shouldRunFrictionWatch: () => false,
      shouldRunFrictionTriage: () => false,
      shouldRunBurnWatch: () => false,
      shouldRunMissionIntake: () => false,
      shouldRunRepairVerifyFiler: () => false,
      recycle: async () => ({}),
    };
  }

  it('AutoFix OFF: the tick does NOT call the forge AND does NOT advance the throttle clock', async () => {
    const project = freshTickProject();
    _resetRepairForgeThrottle(project);
    const calls: string[] = [];

    await runOrchestratorTick({
      ...baseDeps(project),
      isAutoFixEnabled: () => false,
      // Delegates to the REAL (side-effecting) gate, so a wrong && order would stamp the clock.
      shouldRunRepairForge: (p: string) => { calls.push('gate'); return shouldRunRepairForgePass(p); },
      repairForge: async () => { calls.push('forge'); return { forged: null }; },
    });

    // THE ORDERING CLAIM (asserted first — it is the reason the && order exists): the
    // throttle clock is untouched, so the very next due check still says "run". If the
    // AutoFix check ran AFTER shouldRunRepairForge, this would be false.
    expect(shouldRunRepairForgePass(project)).toBe(true);
    expect(calls).toEqual([]); // neither the throttle gate nor the pass was reached
    _resetRepairForgeThrottle(project);
  });

  it('AutoFix ON: the tick calls the forge exactly as today', async () => {
    const project = freshTickProject();
    _resetRepairForgeThrottle(project);
    const calls: string[] = [];

    await runOrchestratorTick({
      ...baseDeps(project),
      isAutoFixEnabled: () => true,
      shouldRunRepairForge: (p: string) => { calls.push('gate'); return shouldRunRepairForgePass(p); },
      repairForge: async () => { calls.push('forge'); return { forged: null }; },
    });

    expect(calls).toEqual(['gate', 'forge']);
    _resetRepairForgeThrottle(project);
  });

  it('with NO stored row the real gate defaults to enabled — the forge still runs', async () => {
    const project = freshTickProject();
    _resetRepairForgeThrottle(project);
    const calls: string[] = [];

    // No isAutoFixEnabled dep: the tick uses the real store-backed predicate, which must
    // default to ON for an untouched project (today's behaviour is preserved).
    await runOrchestratorTick({
      ...baseDeps(project),
      shouldRunRepairForge: () => true,
      repairForge: async () => { calls.push('forge'); return { forged: null }; },
    });

    expect(calls).toEqual(['forge']);
    _resetRepairForgeThrottle(project);
  });
});
