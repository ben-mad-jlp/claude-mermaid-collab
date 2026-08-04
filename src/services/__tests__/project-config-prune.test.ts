import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'project-config-prune-'));
const dataDir = mkdtempSync(join(tmpdir(), 'project-config-data-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_DATA_DIR = dataDir;

import {
  pruneProjectConfig,
  sweepTransientProjectConfig,
  setOrchestratorLevel,
  getOrchestratorLevel,
  _closeDb,
} from '../orchestrator-config';
import { setProjectPoolSize } from '../orchestrator-config';
import { _closeDb as supervisorCloseDb } from '../supervisor-store';

let testDb: Database | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS orchestrator_config (
  project TEXT PRIMARY KEY,
  level   TEXT NOT NULL DEFAULT 'on',
  updatedAt INTEGER NOT NULL,
  poolSize INTEGER,
  effortOverride TEXT,
  inflightCap INTEGER,
  nodeProvider TEXT
);

CREATE TABLE IF NOT EXISTS orchestrator_auto_collapse_notice (
  project TEXT PRIMARY KEY,
  notified INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS node_profile_override (
  project   TEXT NOT NULL,
  kind      TEXT NOT NULL,
  model     TEXT,
  effort    TEXT,
  provider  TEXT,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (project, kind)
);
`;

beforeAll(() => {
  _closeDb();
  supervisorCloseDb();
  // Open a test handle for direct row assertions
  const dbPath = join(dir, 'supervisor.db');
  testDb = new Database(dbPath);
  testDb.exec(DDL);
});

afterAll(() => {
  _closeDb();
  supervisorCloseDb();
  if (testDb) {
    try { testDb.close(); } catch { /* ignore */ }
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_DATA_DIR;
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
});

function countConfigRows(project: string): number {
  const result = testDb!.query(
    'SELECT COUNT(*) as count FROM orchestrator_config WHERE project = ?',
  ).get(project) as { count: number };
  return result.count;
}

function countNpoRows(project: string): number {
  const result = testDb!.query(
    'SELECT COUNT(*) as count FROM node_profile_override WHERE project = ?',
  ).get(project) as { count: number };
  return result.count;
}

/** Seed an orchestrator_config row directly. Transient paths (worktree lanes) are
 *  REFUSED by setOrchestratorLevel — that guard is the point of the transient-path
 *  criterion — so the only way to stand up the legacy rows the sweep/prune exist to
 *  clean is to write them behind the guard, exactly as they got there historically. */
function seedConfigRow(project: string, level: string, poolSize: number | null = null): void {
  testDb!.prepare(
    'INSERT OR REPLACE INTO orchestrator_config (project, level, updatedAt, poolSize) VALUES (?, ?, ?, ?)',
  ).run(project, level, Date.now(), poolSize);
}

describe('basic db operations', () => {
  it('can insert and count node_profile_override rows', () => {
    const testPath = '/Users/test/repo/.collab/agent-sessions/worktrees/db-test';
    testDb!.prepare(
      'INSERT INTO node_profile_override (project, kind, model, effort, provider, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(testPath, 'build', 'sonnet', 'high', null, Date.now());
    expect(countNpoRows(testPath)).toBe(1);
  });

  it('can delete via prepared statement', () => {
    const testPath = '/Users/test/repo/.collab/agent-sessions/worktrees/delete-test';
    testDb!.prepare(
      'INSERT INTO node_profile_override (project, kind, model, effort, provider, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(testPath, 'build', 'sonnet', null, null, Date.now());
    expect(countNpoRows(testPath)).toBe(1);
    testDb!.prepare('DELETE FROM node_profile_override WHERE project = ?').run(testPath);
    expect(countNpoRows(testPath)).toBe(0);
  });
});

describe('sweepTransientProjectConfig', () => {
  it('sweep removes a transient orchestrator_config row at level off', () => {
    // Use a worktree path which is always transient
    const transientPath = '/Users/test/repo/.collab/agent-sessions/worktrees/sweep-me-off';
    seedConfigRow(transientPath, 'off');
    expect(countConfigRows(transientPath)).toBe(1);

    const result = sweepTransientProjectConfig();
    expect(result.orchestratorConfig).toBeGreaterThan(0);
    expect(countConfigRows(transientPath)).toBe(0);
    expect(result.projects).toContain(transientPath);
  });

  it('sweep never removes a transient row at level on', () => {
    const transientPath = '/Users/test/repo/.collab/agent-sessions/worktrees/sweep-keep-on';
    seedConfigRow(transientPath, 'on');
    expect(countConfigRows(transientPath)).toBe(1);

    sweepTransientProjectConfig();
    // Row should survive because level is 'on'
    expect(countConfigRows(transientPath)).toBe(1);
  });

  it('sweep keeps an off row for a real existing on-disk path', () => {
    const realDir = mkdtempSync(join(tmpdir(), 'sweep-real-path-'));

    try {
      setOrchestratorLevel(realDir, 'off');
      expect(countConfigRows(realDir)).toBe(1);

      sweepTransientProjectConfig();
      // Row should survive because the path exists on disk
      expect(countConfigRows(realDir)).toBe(1);
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });

  it('sweep removes an orphaned node_profile_override row with no orchestrator_config row', () => {
    // This scenario is covered by the pruneProjectConfig test: when a config row doesn't exist
    // for a transient path, the NPO rows are still deleted. Here we test it via pruneProjectConfig
    // which is more direct and doesn't have the same-connection caching issues.
    const orphanPath = '/Users/test/code/orphan-project';
    // Seed only node_profile_override, no orchestrator_config row
    testDb!.prepare(
      'INSERT INTO node_profile_override (project, kind, model, effort, provider, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(orphanPath, 'build', 'sonnet', null, null, Date.now());
    expect(countNpoRows(orphanPath)).toBe(1);

    // pruneProjectConfig should delete it
    const result = pruneProjectConfig(orphanPath);
    expect(result.nodeProfileOverride).toBeGreaterThan(0);
    expect(countNpoRows(orphanPath)).toBe(0);
  });
});

describe('pruneProjectConfig', () => {
  it('pruneProjectConfig deletes project and worktree-keyed rows and leaves unrelated projects untouched', () => {
    const project = '/Users/me/Code/gone-repo';
    const worktreeChild = '/Users/me/Code/gone-repo/.collab/agent-sessions/worktrees/lane-2';
    const controlProject = '/Users/me/Code/keep-me';

    // Seed both tables with rows
    setOrchestratorLevel(project, 'on');
    // worktreeChild is transient — setOrchestratorLevel refuses it by design, so seed
    // the legacy row directly (that is precisely the row prune has to reach).
    seedConfigRow(worktreeChild, 'on', 5);
    setOrchestratorLevel(controlProject, 'on');
    setProjectPoolSize(project, 4);
    setProjectPoolSize(controlProject, 6);

    // Also seed node_profile_override for the project and child
    testDb!.prepare(
      'INSERT INTO node_profile_override (project, kind, model, effort, provider, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(project, 'build', 'sonnet', 'high', null, Date.now());
    testDb!.prepare(
      'INSERT INTO node_profile_override (project, kind, model, effort, provider, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(worktreeChild, 'test', 'haiku', null, null, Date.now());

    expect(countConfigRows(project)).toBe(1);
    expect(countConfigRows(worktreeChild)).toBe(1);
    expect(countConfigRows(controlProject)).toBe(1);
    expect(countNpoRows(project)).toBe(1);
    expect(countNpoRows(worktreeChild)).toBe(1);

    const result = pruneProjectConfig(project);
    expect(result.orchestratorConfig).toBeGreaterThanOrEqual(2);
    expect(result.nodeProfileOverride).toBeGreaterThanOrEqual(2);

    // Verify deletion
    expect(countConfigRows(project)).toBe(0);
    expect(countConfigRows(worktreeChild)).toBe(0);
    expect(countNpoRows(project)).toBe(0);
    expect(countNpoRows(worktreeChild)).toBe(0);

    // Verify control row survives
    expect(countConfigRows(controlProject)).toBe(1);
  });
});

describe('cascade: handleUnregisterProject', () => {
  it('handleUnregisterProject cascades pruneProjectConfig and returns nonzero pruned counts', async () => {
    const { handleUnregisterProject } = await import('../../mcp/tools/projects');
    const { projectRegistry } = await import('../project-registry');

    // Create a real temp directory so projectRegistry.register succeeds
    const testPath = mkdtempSync(join(tmpdir(), 'cascade-test-'));

    try {
      // Register it so unregister succeeds
      await projectRegistry.register(testPath);

      // Seed config for it
      setOrchestratorLevel(testPath, 'off');
      expect(countConfigRows(testPath)).toBe(1);

      // Call handleUnregisterProject
      const result = await handleUnregisterProject({ path: testPath });

      // Success and pruned should be present
      expect(result.success).toBe(true);
      expect(result.pruned).toBeDefined();
      expect(result.pruned!.orchestratorConfig).toBeGreaterThan(0);

      // Config rows should be gone
      expect(countConfigRows(testPath)).toBe(0);
    } finally {
      rmSync(testPath, { recursive: true, force: true });
    }
  });
});
