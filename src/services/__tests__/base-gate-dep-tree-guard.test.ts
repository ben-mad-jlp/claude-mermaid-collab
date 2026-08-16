/**
 * Base-gate dependency-tree precondition guard: the gate aborts with an error status
 * if any declared suite/typechecks lane root lacks a node_modules directory, before
 * spawning any lane.
 *
 * Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import { resolveBaseGreen, runBaseGate, type LeafGateConfig } from '../leaf-gate';
import { probeDepTrees, requiredDepRoots } from '../dep-tree-guard';
import { getEpicBaseGate, _closeLedgerDb } from '../worker-ledger';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { resetBaseGateCoalescer } from '../base-gate-coalescer';

let supervisorDir: string;
let repoDir: string;
let projectDir: string;

beforeEach(() => {
  supervisorDir = mkdtempSync(join(tmpdir(), 'dep-tree-guard-'));
  process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
  _closeLedgerDb();
  _closeSupervisorDb();
  resetBaseGateCoalescer();

  // Create a real git repo with a desktop suite lane.
  repoDir = mkdtempSync(join(tmpdir(), 'dep-tree-repo-'));
  projectDir = repoDir;

  // Initialize git repo and create one commit.
  Bun.spawnSync(['git', 'init'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
  Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
  Bun.spawnSync(['git', 'config', 'user.name', 'Test User'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });

  // Create root package.json.
  Bun.write(join(repoDir, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));

  // Create desktop subdir with package.json (the suite lane cwd).
  mkdirSync(join(repoDir, 'desktop'), { recursive: true });
  Bun.write(join(repoDir, 'desktop', 'package.json'), JSON.stringify({ name: 'desktop', version: '1.0.0' }));

  // Create root node_modules (required by the probe for the root).
  mkdirSync(join(repoDir, 'node_modules'), { recursive: true });

  // Create desktop/node_modules for ARM 2 (will be removed for ARM 1).
  mkdirSync(join(repoDir, 'desktop', 'node_modules'), { recursive: true });

  // Commit everything.
  Bun.spawnSync(['git', 'add', '.'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
  Bun.spawnSync(['git', 'commit', '-m', 'Initial commit'], { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
});

afterEach(() => {
  _closeLedgerDb();
  _closeSupervisorDb();
  resetBaseGateCoalescer();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(supervisorDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

describe('base-gate dependency-tree guard', () => {
  test("missing dep tree: resolveBaseGreen errors, spawns no lane, records zero epic_base_gate rows", async () => {
    // ARM 1: delete desktop/node_modules to trigger the probe failure.
    rmSync(join(repoDir, 'desktop', 'node_modules'), { recursive: true, force: true });

    const cfg: LeafGateConfig = {
      suites: [
        {
          match: /^desktop\//,
          command: 'bun run desktop-test',
          cwd: 'desktop',
        },
      ],
    };

    // Track spawn invocations.
    let spawnCount = 0;
    const spySpawn = async (cwd: string, command: string) => {
      spawnCount++;
      // This should never be called because the probe should fail first.
      return { ran: true, code: 1, output: 'FAIL desktop/src/x.test.ts' };
    };

    const epicId = 'test-epic-1';
    const baseSha = 'abc123';

    const result = await resolveBaseGreen({
      epicId,
      project: projectDir,
      targetProject: projectDir,
      epicBaseSha: baseSha,
      gateCfg: cfg,
      ensureEpicWorktree: async () => ({ path: repoDir }),
      runGate: (p, impacted) =>
        runBaseGate(
          p,
          cfg,
          spySpawn,
          { project: projectDir, baseSha },
          { probe: async () => ({ poisoned: false, paths: [], detail: [] }) },
          impacted,
          { probe: (c, c2) => probeDepTrees(requiredDepRoots(c, c2)) },
        ),
    });

    // Verify result is not null and gate errored due to missing dependency tree.
    expect(result).toBeDefined();
    if (result) {
      expect(result.status).toBe('error');
      expect(result.depTreeDegraded).toBeDefined();
      expect(result.depTreeDegraded?.missing).toContain(join(repoDir, 'desktop'));
      expect(result.reasons[0]).toContain('dependency-tree-missing');
    }

    // Verify no spawn occurred.
    expect(spawnCount).toBe(0);

    // Verify no epic_base_gate row was recorded.
    const epicGate = getEpicBaseGate(epicId, baseSha);
    expect(epicGate).toBeNull();

    // Verify the database was not written to.
    const db = new Database(join(supervisorDir, 'worker-ledger.db'));
    const rows = db.query('SELECT * FROM epic_base_gate WHERE epicId = ?').all(epicId);
    expect(rows.length).toBe(0);
    db.close();
  });

  test("present dep tree: identical tree passes and records exactly one pass row", async () => {
    // ARM 2: desktop/node_modules exists (already created in beforeEach).

    const cfg: LeafGateConfig = {
      suites: [
        {
          match: /^desktop\//,
          command: 'bun run desktop-test',
          cwd: 'desktop',
        },
      ],
    };

    let spawnCount = 0;
    const spySpawn = async (cwd: string, command: string) => {
      spawnCount++;
      // Return a pass since deps are present.
      return { ran: true, code: 0, output: '' };
    };

    const epicId = 'test-epic-2';
    const baseSha = 'def456';

    const result = await resolveBaseGreen({
      epicId,
      project: projectDir,
      targetProject: projectDir,
      epicBaseSha: baseSha,
      gateCfg: cfg,
      ensureEpicWorktree: async () => ({ path: repoDir }),
      runGate: (p, impacted) =>
        runBaseGate(
          p,
          cfg,
          spySpawn,
          { project: projectDir, baseSha },
          { probe: async () => ({ poisoned: false, paths: [], detail: [] }) },
          impacted,
          { probe: (c, c2) => probeDepTrees(requiredDepRoots(c, c2)) },
        ),
    });

    // Verify result is not null and gate passed.
    expect(result).toBeDefined();
    if (result) {
      expect(result.status).toBe('pass');
      expect(result.depTreeDegraded).toBeUndefined();
    }

    // Verify spawn was invoked once.
    expect(spawnCount).toBe(1);

    // Verify exactly one epic_base_gate row was recorded with status 'pass'.
    const epicGate = getEpicBaseGate(epicId, baseSha);
    expect(epicGate).toBeDefined();
    expect(epicGate?.status).toBe('pass');

    // Verify via raw database query.
    const db = new Database(join(supervisorDir, 'worker-ledger.db'));
    const rows = db.query('SELECT * FROM epic_base_gate WHERE epicId = ?').all(epicId) as Array<{ status: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pass');
    db.close();
  });
});
