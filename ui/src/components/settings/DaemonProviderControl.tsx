/**
 * DaemonProviderControl — per-project DEFAULT worker provider (claude / grok-build),
 * shown above the DaemonNodesMatrix in the Bridge "⚙ nodes" panel. This is the project
 * blanket default; per-kind overrides in the matrix (and the MCP-forced guard) take
 * precedence. "inherit" clears the project default (→ env/config → claude).
 *
 * GET  /api/orchestrator/node-provider?project=<abs> → { nodeProvider, choices }
 * POST /api/orchestrator/node-provider { project, nodeProvider }  (null = inherit/clear)
 */
import React, { useCallback, useEffect, useState } from 'react';

const INHERIT = '';

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

export const DaemonProviderControl: React.FC<{ project: string }> = ({ project }) => {
  const [value, setValue] = useState<string>(INHERIT); // '' = inherit (unset)
  const [choices, setChoices] = useState<string[]>(['claude', 'grok-build']);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const data = await apiGet(`/api/orchestrator/node-provider?project=${encodeURIComponent(project)}`);
      if (cancelled) return;
      setValue(typeof data.nodeProvider === 'string' ? data.nodeProvider : INHERIT);
      if (Array.isArray(data.choices)) setChoices(data.choices);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const commit = useCallback((next: string) => {
    if (busy || !project) return;
    setBusy(true);
    setValue(next); // optimistic
    void (async () => {
      try {
        const data = await apiPost('/api/orchestrator/node-provider', { project, nodeProvider: next === INHERIT ? null : next });
        if (typeof data?.nodeProvider === 'string') setValue(data.nodeProvider);
        else if (data && 'nodeProvider' in data) setValue(INHERIT); // null → inherit
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, project]);

  return (
    <div
      data-testid="daemon-provider-control"
      className={`flex items-center gap-1.5 text-2xs ${loaded ? '' : 'opacity-50'}`}
      title="Default worker provider for this project's daemon nodes. Per-node overrides in the matrix below win; MCP nodes always run on Claude."
    >
      <span className="text-gray-500 dark:text-gray-400">daemon provider</span>
      <select
        data-testid="daemon-provider-select"
        disabled={busy}
        value={value}
        onChange={(e) => commit(e.target.value)}
        className="text-2xs bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 outline-none cursor-pointer disabled:cursor-not-allowed"
      >
        <option value={INHERIT}>inherit (claude)</option>
        {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
};

export default DaemonProviderControl;
