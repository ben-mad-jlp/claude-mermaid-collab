/**
 * PoolSizeControl — per-project worker pool-size stepper, shown next to the
 * OrchestratorLadder. Sets how many concurrent workers (slots per type) the
 * daemon may run for this project. A single number, expanded to a uniform
 * per-type PoolConfig by the daemon.
 *
 * GET  /api/orchestrator/pool-size?project=<abs> → { project, poolSize, default, max }
 * POST /api/orchestrator/pool-size body { project, poolSize } → same
 *   poolSize null = "use the global default".
 */
import React, { useCallback, useEffect, useState } from 'react';

export interface PoolSizeControlProps {
  project: string;
}

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

export const PoolSizeControl: React.FC<PoolSizeControlProps> = ({ project }) => {
  // The effective number shown: the per-project override, or the default when unset.
  const [effective, setEffective] = useState<number>(3);
  // Whether the project has an explicit override (vs. inheriting the default).
  const [overridden, setOverridden] = useState(false);
  const [def, setDef] = useState(3);
  const [max, setMax] = useState(16);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet(`/api/orchestrator/pool-size?project=${encodeURIComponent(project)}`);
        if (cancelled) return;
        if (typeof data.default === 'number') setDef(data.default);
        if (typeof data.max === 'number') setMax(data.max);
        setOverridden(data.poolSize != null);
        setEffective(typeof data.poolSize === 'number' ? data.poolSize : (typeof data.default === 'number' ? data.default : 3));
      } catch { /* best-effort */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const commit = useCallback((next: number | null) => {
    if (busy || !project) return;
    setBusy(true);
    // Optimistic.
    if (next == null) { setOverridden(false); setEffective(def); }
    else { setOverridden(true); setEffective(next); }
    void (async () => {
      try {
        const data = await apiPost('/api/orchestrator/pool-size', { project, poolSize: next });
        setOverridden(data?.poolSize != null);
        if (typeof data?.poolSize === 'number') setEffective(data.poolSize);
        else if (typeof data?.default === 'number') setEffective(data.default);
      } catch { /* keep optimistic */ }
      finally { setBusy(false); }
    })();
  }, [busy, project, def]);

  const step = (delta: number) => commit(Math.max(1, Math.min(max, effective + delta)));

  return (
    <div
      data-testid="pool-size-control"
      data-project={project}
      data-pool-size={effective}
      data-overridden={overridden}
      title={`Worker pool size for this project — up to ${effective} concurrent worker${effective === 1 ? '' : 's'} per type${overridden ? '' : ` (inheriting the default of ${def})`}. Max ${max}.`}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 border-gray-300 dark:border-gray-600 ${busy ? 'opacity-60' : ''} ${loaded ? '' : 'opacity-50'}`}
    >
      <span className="px-1.5 py-0.5 text-gray-500 dark:text-gray-400">pool</span>
      <button
        type="button"
        data-testid="pool-size-dec"
        disabled={busy || effective <= 1}
        onClick={() => step(-1)}
        title="Fewer workers"
        className="px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      >
        −
      </button>
      <span
        data-testid="pool-size-value"
        className={`px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 tabular-nums ${overridden ? 'bg-info-500 dark:bg-info-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
      >
        {effective}
      </span>
      <button
        type="button"
        data-testid="pool-size-inc"
        disabled={busy || effective >= max}
        onClick={() => step(1)}
        title="More workers"
        className="px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      >
        +
      </button>
      {overridden && (
        <button
          type="button"
          data-testid="pool-size-reset"
          disabled={busy}
          onClick={() => commit(null)}
          title={`Reset to the default (${def})`}
          className="px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default PoolSizeControl;
