import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the supervisor.db BEFORE the store module opens it (openDb() caches the
// handle module-globally on first call).
const dir = mkdtempSync(join(tmpdir(), 'orchestrator-config-transient-guard-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  setOrchestratorLevel,
  setNodeProfileOverride,
  setProjectPoolSize,
  setAutoFixLevel,
  getAutoFixLevel,
  _closeDb,
} from '../orchestrator-config';

let rawDb: Database;

function countRows(table: 'orchestrator_config' | 'node_profile_override', project: string): number {
  const row = rawDb
    .query(`SELECT COUNT(*) AS c FROM ${table} WHERE project = ?`)
    .get(project) as { c: number };
  return row.c;
}

describe('orchestrator-config transient-path guard', () => {
  let savedAllowTransient: string | undefined;

  beforeAll(() => {
    // Trigger openDb()'s DDL (table creation) via a real, non-transient write before
    // any raw SELECT touches the file — the guarded setters below never call openDb()
    // when refuseTransient() short-circuits, so the schema wouldn't otherwise exist yet.
    setOrchestratorLevel('/Users/benmaderazo/Code/claude-mermaid-collab-schema-init', 'on');
    rawDb = new Database(join(process.env.MERMAID_SUPERVISOR_DIR!, 'supervisor.db'));
  });

  afterAll(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    _closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    savedAllowTransient = process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '0';
  });

  afterEach(() => {
    if (savedAllowTransient === undefined) {
      delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    } else {
      process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = savedAllowTransient;
    }
  });

  it('refuses writes to orchestrator_config and node_profile_override for a /tmp project path', () => {
    const project = `/tmp/junk-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOrchestratorLevel(project, 'on');
    setNodeProfileOverride(project, 'implement', 'sonnet', 'high', null);
    setProjectPoolSize(project, 4);

    expect(countRows('orchestrator_config', project)).toBe(0);
    expect(countRows('node_profile_override', project)).toBe(0);
  });

  it('refuses writes for a .collab/agent-sessions/worktrees path', () => {
    const project = join(process.cwd(), '.collab/agent-sessions/worktrees/lane-1');
    setOrchestratorLevel(project, 'on');
    setNodeProfileOverride(project, 'implement', 'sonnet', 'high', null);
    setProjectPoolSize(project, 4);

    expect(countRows('orchestrator_config', project)).toBe(0);
    expect(countRows('node_profile_override', project)).toBe(0);
  });

  it('still writes normally for a real (non-transient) project path', () => {
    // process.cwd() is itself a transient worktree lane in this leaf's execution
    // environment (.collab/agent-sessions/worktrees/...), so a real non-worktree,
    // non-/tmp repo path is used here instead to exercise the non-transient branch.
    const project = '/Users/benmaderazo/Code/claude-mermaid-collab';
    setOrchestratorLevel(project, 'on');
    setNodeProfileOverride(project, 'implement', 'sonnet', 'high', null);
    setProjectPoolSize(project, 4);

    expect(countRows('orchestrator_config', project)).toBe(1);
    expect(countRows('node_profile_override', project)).toBe(1);
  });

  it('setAutoFixLevel refuses transient paths and writes normally for a real path', () => {
    const transientProject = `/tmp/junk-proj-autofix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAutoFixLevel(transientProject, 'off');
    expect(countRows('orchestrator_config', transientProject)).toBe(0);
    // Nothing was stored, so the read falls through to the 'on' default — a refused
    // write must never read back as a successful hold.
    expect(getAutoFixLevel(transientProject)).toBe('on');

    const realProject = '/Users/benmaderazo/Code/claude-mermaid-collab-autofix-check';
    setAutoFixLevel(realProject, 'off');
    expect(countRows('orchestrator_config', realProject)).toBe(1);
    expect(getAutoFixLevel(realProject)).toBe('off');
  });

  it('setProjectPoolSize refuses transient paths and writes normally for a real path', () => {
    const transientProject = `/tmp/junk-proj-pool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setProjectPoolSize(transientProject, 4);
    expect(countRows('orchestrator_config', transientProject)).toBe(0);

    const realProject = '/Users/benmaderazo/Code/claude-mermaid-collab-pool-check';
    setProjectPoolSize(realProject, 4);
    expect(countRows('orchestrator_config', realProject)).toBe(1);
  });
});
