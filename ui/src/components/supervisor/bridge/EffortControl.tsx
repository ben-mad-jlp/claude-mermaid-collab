/**
 * EffortControl — per-project reasoning-effort override for daemon-spawned claude
 * worker nodes. Shown next to PoolSizeControl + the OrchestratorLadder.
 *
 * "auto" (null) = use the per-node-kind NODE_PROFILE defaults (high for the
 * reasoning-heavy nodes, medium for the rest). Any explicit level applies uniformly
 * to every node the daemon spawns for this project.
 *
 * GET  /api/orchestrator/effort?project=<abs> → { project, effort, levels }
 * POST /api/orchestrator/effort body { project, effort } → same  (effort null = auto)
 */
import React, { useCallback, useEffect, useState } from 'react';

export interface EffortControlProps {
  project: string;
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const AUTO = 'auto';

async function apiGet(path: string): Promise<any> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) return (await mc.invokeOnServer('local', { path, method: 'GET' }))?.body ?? {};
  const r = await fetch(path);
  return r.ok ? r.json() : {};
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) return (await mc.invokeOnServer('local', { path, method: 'POST', body }))?.body ?? {};
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.ok ? r.json() : {};
}

export const EffortControl: React.FC<EffortControlProps> = ({ project }) => {
  const [effort, setEffort] = useState<Effort | null>(null); // null = auto
  const [levels, setLevels] = useState<Effort[]>(['low', 'medium', 'high', 'xhigh', 'max']);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet(`/api/orchestrator/effort?project=${encodeURIComponent(project)}`);
        if (cancelled) return;
        if (Array.isArray(data.levels) && data.levels.length) setLevels(data.levels);
        setEffort(data.effort ?? null);
      } catch { /* best-effort */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const commit = useCallback((next: Effort | null) => {
    if (busy || !project) return;
    const prev = effort;
    setEffort(next);
    setBusy(true);
    void (async () => {
      try {
        const data = await apiPost('/api/orchestrator/effort', { project, effort: next });
        setEffort(data?.effort ?? null);
      } catch { setEffort(prev); }
      finally { setBusy(false); }
    })();
  }, [busy, project, effort]);

  const overridden = effort != null;

  return (
    <label
      data-testid="effort-control"
      data-project={project}
      data-effort={effort ?? AUTO}
      data-overridden={overridden}
      title={`Reasoning effort for this project's daemon-spawned worker nodes. ${overridden ? `Forced to "${effort}" for every node.` : 'Auto — per-node-kind defaults (high for blueprint/review, medium for build/read).'}`}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 border-gray-300 dark:border-gray-600 ${busy ? 'opacity-60' : ''} ${loaded ? '' : 'opacity-50'}`}
    >
      <span className="px-1.5 py-0.5 text-gray-500 dark:text-gray-400">effort</span>
      <select
        data-testid="effort-select"
        disabled={busy}
        value={effort ?? AUTO}
        onChange={(e) => commit(e.target.value === AUTO ? null : (e.target.value as Effort))}
        className={`px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 outline-none cursor-pointer disabled:cursor-not-allowed ${overridden ? 'bg-info-500 dark:bg-info-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
      >
        <option value={AUTO}>auto</option>
        {levels.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
    </label>
  );
};

export default EffortControl;
