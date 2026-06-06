import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-launch-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  addSupervised,
  getSupervisedLaunchProject,
  listSupervised,
  _closeDb,
} from '../supervisor-store';
import { tmuxBaseName } from '../tmux-naming';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

/**
 * Regression for the cross-project wrong/empty-terminal bug (todo 2e07d1c5):
 * a coordinator-spawned worker whose targetProject != tracking project has its
 * tmux created under tmuxBaseName(targetProject, poolName), but the supervised
 * row was keyed by the tracking project — so create-terminal derived
 * tmuxBaseName(project, poolName), a DIFFERENT name, and attached to nothing.
 * Fix (option b): record the launch project on the supervised row; create-terminal
 * resolves it and derives the tmux name from the launch project.
 */
describe('supervised launchProject — cross-project tmux name resolution', () => {
  const tracking = '/Users/me/Code/claude-mermaid-collab';
  const target = '/Users/me/Code/build123d-ocp-mcp';
  const pool = 'backend-1';

  it('cross-project: create-terminal derives the SAME tmux name the worker was launched under', () => {
    // Spawn side: tmux launched under the TARGET project.
    const spawnTmux = tmuxBaseName(target, pool);

    // Coordinator records the supervised row with the launch (target) project.
    addSupervised(tracking, pool, 'spawn', '', target);

    // Create-terminal side: resolve the launch project from the supervised row
    // (keyed by the tracking project, the way the UI calls it) and derive the name.
    const launchProject = getSupervisedLaunchProject(tracking, pool) ?? tracking;
    const createTerminalTmux = tmuxBaseName(launchProject, pool);

    expect(launchProject).toBe(target);
    expect(createTerminalTmux).toBe(spawnTmux);
    // And it must NOT be the (buggy) tracking-project-derived name.
    expect(createTerminalTmux).not.toBe(tmuxBaseName(tracking, pool));
  });

  it('same-project: launchProject is stored null and create-terminal falls back to project', () => {
    const samePool = 'backend-2';
    addSupervised(tracking, samePool, 'spawn', '', tracking); // target == tracking

    expect(getSupervisedLaunchProject(tracking, samePool)).toBeNull();

    const launchProject = getSupervisedLaunchProject(tracking, samePool) ?? tracking;
    expect(tmuxBaseName(launchProject, samePool)).toBe(tmuxBaseName(tracking, samePool));
  });

  it('launchProject defaults to null when omitted (manual/roadmap subscriptions)', () => {
    addSupervised(tracking, 'manual-lane', 'manual');
    expect(getSupervisedLaunchProject(tracking, 'manual-lane')).toBeNull();
  });

  it('unknown row → null (create-terminal falls back to project)', () => {
    expect(getSupervisedLaunchProject(tracking, 'never-added')).toBeNull();
  });

  it('listSupervised exposes launchProject', () => {
    const row = listSupervised().find((r) => r.project === tracking && r.session === pool);
    expect(row?.launchProject).toBe(target);
  });
});
