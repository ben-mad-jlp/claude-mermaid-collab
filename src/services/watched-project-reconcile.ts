import type { ProjectRegistry } from './project-registry';
import { projectRegistry as defaultRegistry } from './project-registry.js';
import { listWatchedProjects as defaultListWatched } from './supervisor-store.js';
import { isTransientProjectPath } from './project-registry.js';

export interface ReconcileResult {
  registered: string[];
  skippedTransient: string[];
}

/**
 * Reconcile watched projects into the registry.
 *
 * The supervisor's watched set is the PERSISTENT source of truth for the Bridge.
 * Here we ensure every still-watched project stays registered. We deliberately
 * do NOT auto-watch every registered project — that would re-flood the Bridge
 * on each restart.
 *
 * NEW: transient paths (worktrees, /tmp, etc.) are skipped before registration,
 * so they never reach registry.register().
 */
export async function reconcileWatchedProjectsIntoRegistry(deps?: {
  registry?: ProjectRegistry;
  listWatched?: () => Array<{ project: string }>;
}): Promise<ReconcileResult> {
  const registry = deps?.registry ?? defaultRegistry;
  const listWatched = deps?.listWatched ?? defaultListWatched;

  const registered: string[] = [];
  const skippedTransient: string[] = [];

  const registeredPaths = new Set((await registry.list()).map((p) => p.path));

  for (const w of listWatched()) {
    // NEW guard: skip transient paths before the registeredPaths.has check,
    // so they never reach registry.register().
    if (isTransientProjectPath(w.project)) {
      skippedTransient.push(w.project);
      continue;
    }

    if (registeredPaths.has(w.project)) continue;

    // Per-path catch swallow — a watched path that vanished from disk makes
    // register throw, but we continue so one bad path doesn't block the rest.
    await registry
      .register(w.project)
      .then(() => {
        registered.push(w.project);
      })
      .catch(() => {});
  }

  return { registered, skippedTransient };
}
