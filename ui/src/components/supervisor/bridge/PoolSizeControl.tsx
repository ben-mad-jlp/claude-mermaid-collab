/**
 * PoolSizeControl — per-project CONCURRENCY stepper, shown next to the OrchestratorLadder.
 *
 * Post-unification this drives the canonical fire-and-track in-flight cap (the real
 * limiter on "how many leaves run at once for this project"), NOT the legacy worker
 * pool-size — so this control and the Executor tab's "Concurrency Pools" show the SAME
 * number. The backend keeps the worker pool-size in lockstep so slots never bottleneck
 * below the cap.
 *
 * GET  /api/leaf-executor/inflight-caps?project=<abs> → { globalMax, projectMax }
 * POST /api/leaf-executor/inflight-caps body { project, projectMax } → same
 */
import React, { useCallback, useEffect, useState } from 'react';

export interface PoolSizeControlProps {
  project: string;
}

const MIN_CAP = 1;
const MAX_CAP = 32;

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
  // The effective per-project in-flight cap (max leaves running at once for this project).
  const [effective, setEffective] = useState<number>(2);
  const [globalMax, setGlobalMax] = useState<number>(4);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet(`/api/leaf-executor/inflight-caps?project=${encodeURIComponent(project)}`);
        if (cancelled) return;
        if (typeof data.projectMax === 'number') setEffective(data.projectMax);
        if (typeof data.globalMax === 'number') setGlobalMax(data.globalMax);
      } catch { /* best-effort */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const commit = useCallback((next: number) => {
    if (busy || !project) return;
    setBusy(true);
    setEffective(next); // optimistic
    void (async () => {
      try {
        const data = await apiPost('/api/leaf-executor/inflight-caps', { project, projectMax: next });
        if (typeof data?.projectMax === 'number') setEffective(data.projectMax);
        if (typeof data?.globalMax === 'number') setGlobalMax(data.globalMax);
      } catch { /* keep optimistic */ }
      finally { setBusy(false); }
    })();
  }, [busy, project]);

  const step = (delta: number) => commit(Math.max(MIN_CAP, Math.min(MAX_CAP, effective + delta)));

  return (
    <div
      data-testid="pool-size-control"
      data-project={project}
      data-pool-size={effective}
      title={`Max concurrent leaves in flight for this project (${effective}). The canonical fire-and-track cap — matches the Executor tab's "Concurrency Pools". Global fleet ceiling: ${globalMax}. Range ${MIN_CAP}–${MAX_CAP}.`}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 border-gray-300 dark:border-gray-600 ${busy ? 'opacity-60' : ''} ${loaded ? '' : 'opacity-50'}`}
    >
      <span className="px-1.5 py-0.5 text-gray-500 dark:text-gray-400">conc</span>
      <button
        type="button"
        data-testid="pool-size-dec"
        disabled={busy || effective <= MIN_CAP}
        onClick={() => step(-1)}
        title="Fewer concurrent leaves"
        className="px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      >
        −
      </button>
      <span
        data-testid="pool-size-value"
        className="px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 tabular-nums bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
      >
        {effective}
      </span>
      <button
        type="button"
        data-testid="pool-size-inc"
        disabled={busy || effective >= MAX_CAP}
        onClick={() => step(1)}
        title="More concurrent leaves"
        className="px-1.5 py-0.5 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      >
        +
      </button>
    </div>
  );
};

export default PoolSizeControl;
