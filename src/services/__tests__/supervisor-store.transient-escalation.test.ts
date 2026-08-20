import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-transient-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  _closeDb,
} from '../supervisor-store';
import { trackingProjectRoot } from '../project-registry';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

/**
 * Regression: createEscalation must refuse transient project paths (/tmp, tmpdir,
 * and other os.tmpdir() variants) to prevent escalations from being created in
 * ephemeral contexts that would be lost on cleanup. The guard runs on the
 * post-trackingProjectRoot value, so worktree paths (which normalize to their
 * repo root) still succeed.
 */
describe('createEscalation — transient project path refusal', () => {
  // Fixed synthetic, non-existent, non-transient project root (not under /tmp or similar).
  // trackingProjectRoot performs pure string parsing and does not access the filesystem.
  const REAL_PROJECT = '/Users/collab-fixtures/transient-escalation-repo';

  let savedFlag: string | undefined;

  beforeEach(() => {
    savedFlag = process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
  });

  afterEach(() => {
    if (savedFlag !== undefined) {
      process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = savedFlag;
    } else {
      delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    }
  });

  it('throws on a /tmp project path and writes zero rows', () => {
    const tmpProject = '/tmp/junk-proj-' + Math.random().toString(36).slice(2);
    let threw = false;
    try {
      createEscalation({
        audience: 'human',
        project: tmpProject,
        session: 'test-session',
        kind: 'blocker',
        questionText: 'test escalation',
      });
    } catch (e) {
      threw = true;
      expect((e as Error).message).toMatch(/refusing transient project path/);
    }
    expect(threw).toBe(true);

    // Verify zero rows were written to the escalation table for this project.
    const db = new Database(join(process.env.MERMAID_SUPERVISOR_DIR!, 'supervisor.db'));
    try {
      const count = db.query('SELECT COUNT(*) as cnt FROM escalation WHERE project = ?').get(tmpProject) as { cnt: number };
      expect(count.cnt).toBe(0);
    } finally {
      db.close();
    }
  });

  it('still creates an escalation for a real project path', () => {
    const realProject = trackingProjectRoot(REAL_PROJECT);
    const { escalation, isNew } = createEscalation({
      audience: 'human',
      project: realProject,
      session: 'test-session-real',
      kind: 'decision',
      questionText: 'test escalation real project',
    });
    expect(isNew).toBe(true);
    expect(escalation.project).toBe(realProject);

    // Verify the row was written.
    const db = new Database(join(process.env.MERMAID_SUPERVISOR_DIR!, 'supervisor.db'));
    try {
      const count = db.query('SELECT COUNT(*) as cnt FROM escalation WHERE project = ?').get(realProject) as { cnt: number };
      expect(count.cnt).toBe(1);
    } finally {
      db.close();
    }
  });

  it('still succeeds for a worktree path, landing under the normalized repo root', () => {
    const realProject = trackingProjectRoot(REAL_PROJECT);
    const worktreePath = `${realProject}/.collab/agent-sessions/worktrees/lane-1`;

    const { escalation, isNew } = createEscalation({
      audience: 'human',
      project: worktreePath,
      session: 'test-session-worktree',
      kind: 'decision',
      questionText: 'test escalation from worktree',
    });

    expect(isNew).toBe(true);
    // The stored project should be the normalized root, not the worktree path.
    expect(escalation.project).toBe(realProject);

    // Verify the row exists under the normalized root.
    const db = new Database(join(process.env.MERMAID_SUPERVISOR_DIR!, 'supervisor.db'));
    try {
      const row = db.query('SELECT project FROM escalation WHERE id = ?').get(escalation.id);
      expect(row).toBeDefined();
      expect((row as { project: string }).project).toBe(realProject);
    } finally {
      db.close();
    }
  });
});
