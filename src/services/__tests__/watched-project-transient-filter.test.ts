import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import * as fs from 'fs';
import {
  reconcileWatchedProjectsIntoRegistry,
  type ReconcileResult,
} from '../watched-project-reconcile';
import {
  addWatchedProject,
  _closeDb,
} from '../supervisor-store';
import {
  isTransientProjectPath,
  ProjectRegistry,
} from '../project-registry';

describe('watched-project-reconcile', () => {
  let originalEnv: string | undefined;
  let originalSupervisorDir: string | undefined;
  let tmpDataDir: string;

  beforeEach(() => {
    // Save and delete the transient-project-config override so tmpdir paths
    // are classified as transient (not narrowed to worktrees only).
    originalEnv = process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;

    // Point the supervisor store at a fresh tmpdir so addWatchedProject
    // writes to an isolated DB.
    originalSupervisorDir = process.env.MERMAID_SUPERVISOR_DIR;
    tmpDataDir = fs.mkdtempSync(join(tmpdir(), 'watched-reconcile-'));
    process.env.MERMAID_SUPERVISOR_DIR = tmpDataDir;

    // Close any cached DB handle so a fresh one opens under the new MERMAID_SUPERVISOR_DIR.
    _closeDb();
  });

  afterEach(() => {
    // Restore the original environment.
    if (originalEnv === undefined) {
      delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    } else {
      process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = originalEnv;
    }

    if (originalSupervisorDir === undefined) {
      delete process.env.MERMAID_SUPERVISOR_DIR;
    } else {
      process.env.MERMAID_SUPERVISOR_DIR = originalSupervisorDir;
    }

    // Close the DB again so it doesn't leak between tests.
    _closeDb();

    // Clean up the temp directory.
    try {
      fs.rmSync(tmpDataDir, { recursive: true });
    } catch {}
  });

  it('startup re-registration skips transient tmpdir paths', async () => {
    // Create a transient tmpdir fixture.
    const fixtureDir = fs.mkdtempSync(join(tmpdir(), 'watched-transient-'));

    // Assert it is classified as transient up front.
    expect(isTransientProjectPath(fixtureDir)).toBe(true);

    // Seed it into the watched projects.
    addWatchedProject(fixtureDir);

    // Create an isolated registry.
    const registry = new ProjectRegistry(join(tmpDataDir, 'projects.json'));

    // Run the reconcile.
    const result: ReconcileResult = await reconcileWatchedProjectsIntoRegistry({
      registry,
      listWatched: () => [{ project: fixtureDir }],
    });

    // Assert the transient path was skipped, not registered.
    expect(result.skippedTransient).toContain(fixtureDir);

    // Assert it does not appear in the registry.
    const registeredList = await registry.list();
    const transientInRegistry = registeredList.filter((p) =>
      isTransientProjectPath(p.path)
    );
    expect(transientInRegistry).toHaveLength(0);

    // Spy on the registry to prove the skip happens at the reconcile layer,
    // not inside registry.register().
    const calls: string[] = [];
    const spyRegistry = {
      list: async () => [],
      register: async (p: string) => {
        calls.push(p);
        return { created: true };
      },
    } as unknown as ProjectRegistry;

    // Run reconcile with the spy.
    await reconcileWatchedProjectsIntoRegistry({
      registry: spyRegistry,
      listWatched: () => [{ project: fixtureDir }],
    });

    // Assert register was never called with the transient path.
    expect(calls).not.toContain(fixtureDir);

    // Clean up the fixture.
    try {
      fs.rmSync(fixtureDir, { recursive: true });
    } catch {}
  });

  it('does not skip non-transient watched paths', async () => {
    // Use a literal absolute path that is not transient (not under tmpdir or worktree).
    // The spy registry performs no existsSync, so no real directory is needed.
    const nonTransientPath = '/Users/shared/non-transient-fixture';

    // Assert it is NOT classified as transient.
    expect(isTransientProjectPath(nonTransientPath)).toBe(false);

    // Spy on the registry to capture register calls.
    const calls: string[] = [];
    const spyRegistry = {
      list: async () => [],
      register: async (p: string) => {
        calls.push(p);
        return { created: true };
      },
    } as unknown as ProjectRegistry;

    // Run reconcile with a non-transient watched path.
    await reconcileWatchedProjectsIntoRegistry({
      registry: spyRegistry,
      listWatched: () => [{ project: nonTransientPath }],
    });

    // Assert register WAS called with the non-transient path.
    expect(calls).toContain(nonTransientPath);
  });
});
