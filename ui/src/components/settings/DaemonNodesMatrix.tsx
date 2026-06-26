/**
 * DaemonNodesMatrix — per-node-kind model + effort editor for the leaf-executor's
 * claude worker nodes, scoped to a project. One row per node kind (blueprint,
 * implement, review, …); each row sets a model override and an effort override, or
 * "inherit" to fall back to the node kind's NODE_PROFILE default. Mirrors the
 * TieringEditor pattern (in-context, scoped to the lane's project).
 *
 * Per-node hybrid routing — grok `implement`, claude `blueprint`+`review` is the
 * validated sweet spot. MCP-forced kinds (report/driveexec) lock to claude.
 *
 * GET  /api/orchestrator/node-profiles?project=<abs>
 *   → { rows: [{ kind, …, modelOverride, effortOverride, providerOverride,
 *                effectiveModel, effectiveEffort, effectiveProvider, mcpForced }],
 *        claudeModels, grokModels, providers, levels }
 * POST /api/orchestrator/node-profiles { project, kind, model, effort, provider }
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Row {
  kind: string;
  desc: string;
  defaultModel: string;
  defaultEffort: string;
  modelOverride: string | null;
  effortOverride: string | null;
  providerOverride: string | null;
  effectiveModel: string;
  effectiveEffort: string;
  effectiveProvider: string;
  mcpForced: boolean;
}

interface Group {
  key: string;
  label: string;
  firesWhen: string;
  kinds: string[];
  defaultCollapsed: boolean;
}

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

export const DaemonNodesMatrix: React.FC<{ project: string }> = ({ project }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [grokModels, setGrokModels] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const collapseInitedRef = useRef(false);

  const load = useCallback(async () => {
    if (!project) return;
    const data = await apiGet(`/api/orchestrator/node-profiles?project=${encodeURIComponent(project)}`);
    setRows(Array.isArray(data.rows) ? data.rows : []);
    const list: Group[] = Array.isArray(data.groups) ? data.groups : [];
    setGroups(list);
    if (!collapseInitedRef.current && list.length) {
      setCollapsed(Object.fromEntries(list.map(g => [g.key, !!g.defaultCollapsed])));
      collapseInitedRef.current = true;
    }
    setClaudeModels(Array.isArray(data.claudeModels) ? data.claudeModels : (Array.isArray(data.models) ? data.models : []));
    setGrokModels(Array.isArray(data.grokModels) ? data.grokModels : []);
    setProviders(Array.isArray(data.providers) ? data.providers : ['claude', 'grok-build']);
    setLevels(Array.isArray(data.levels) ? data.levels : []);
    setLoaded(true);
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback((kind: string, patch: { model?: string | null; effort?: string | null; provider?: string | null }) => {
    const cur = rows.find((r) => r.kind === kind);
    if (!cur) return;
    const model = patch.model !== undefined ? patch.model : cur.modelOverride;
    const effort = patch.effort !== undefined ? patch.effort : cur.effortOverride;
    const provider = patch.provider !== undefined ? patch.provider : cur.providerOverride;
    // Switching provider invalidates a cross-provider model override → clear it.
    const modelToSend = patch.provider !== undefined && patch.provider !== cur.providerOverride ? null : model;
    setBusyKind(kind);
    void (async () => {
      try {
        await apiPost('/api/orchestrator/node-profiles', { project, kind, model: modelToSend, effort, provider });
        await load(); // re-pull so effective columns reflect the server's resolution
      } finally {
        setBusyKind(null);
      }
    })();
  }, [project, rows, load]);

  const broadcast = useCallback(() => {
    if (broadcasting || !project) return;
    if (!window.confirm('Push this project’s provider + model + effort settings to ALL other projects? This replaces their per-node settings.')) return;
    setBroadcasting(true);
    setBroadcastMsg(null);
    void (async () => {
      try {
        const data = await apiPost('/api/orchestrator/node-profiles/broadcast', { project });
        const n = typeof data?.applied === 'number' ? data.applied : 0;
        setBroadcastMsg(`Applied to ${n} project${n === 1 ? '' : 's'}.`);
      } catch {
        setBroadcastMsg('Failed to push settings.');
      } finally {
        setBroadcasting(false);
      }
    })();
  }, [broadcasting, project]);

  const renderRow = (r: Row) => {
    const busy = busyKind === r.kind;
    const overridden = r.modelOverride != null || r.effortOverride != null || r.providerOverride != null;
    // Model choices follow the row's EFFECTIVE provider. grok-build → CLI grok models;
    // grok-api → the flagship reasoner (fixed); else claude models.
    const modelChoices =
      r.effectiveProvider === 'grok-build' ? grokModels :
      r.effectiveProvider === 'grok-api' ? ['grok-4.3'] :
      claudeModels;
    const isGrokProvider = r.effectiveProvider === 'grok-build' || r.effectiveProvider === 'grok-api';
    return (
      <tr key={r.kind} data-testid={`node-row-${r.kind}`} className={`border-t border-gray-100 dark:border-gray-800 ${busy ? 'opacity-60' : ''}`}>
        <td className="pr-2 py-0.5 align-top">
          <div className={`font-mono ${overridden ? 'text-info-600 dark:text-info-400' : 'text-gray-700 dark:text-gray-200'}`}>{r.kind}</div>
          <div className="text-3xs text-gray-600 dark:text-gray-300 max-w-[260px] leading-tight">{r.desc}</div>
        </td>
        <td className="px-2 py-0.5">
          {r.mcpForced ? (
            <span
              data-testid={`node-provider-${r.kind}-locked`}
              title="Uses MCP tools — must run on Claude (Grok has no MCP)"
              className="text-2xs text-gray-400 dark:text-gray-500 italic"
            >
              claude 🔒
            </span>
          ) : (
            <select
              data-testid={`node-provider-${r.kind}`}
              disabled={busy}
              value={r.providerOverride ?? INHERIT}
              onChange={(e) => update(r.kind, { provider: e.target.value === INHERIT ? null : e.target.value })}
              className="text-2xs bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 outline-none cursor-pointer disabled:cursor-not-allowed"
            >
              <option value={INHERIT}>inherit ({r.effectiveProvider})</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </td>
        <td className="px-2 py-0.5">
          <select
            data-testid={`node-model-${r.kind}`}
            disabled={busy}
            value={r.modelOverride ?? INHERIT}
            onChange={(e) => update(r.kind, { model: e.target.value === INHERIT ? null : e.target.value })}
            className="text-2xs bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 outline-none cursor-pointer disabled:cursor-not-allowed"
          >
            <option value={INHERIT}>inherit ({r.defaultModel})</option>
            {modelChoices.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </td>
        <td className="px-2 py-0.5">
          {isGrokProvider ? (
            <span
              data-testid={`node-effort-${r.kind}-na`}
              title="grok invokers ignore effort — only Claude nodes use it"
              className="text-2xs text-gray-400 dark:text-gray-500 italic"
            >
              n/a
            </span>
          ) : (
            <select
              data-testid={`node-effort-${r.kind}`}
              disabled={busy}
              value={r.effortOverride ?? INHERIT}
              onChange={(e) => update(r.kind, { effort: e.target.value === INHERIT ? null : e.target.value })}
              className="text-2xs bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 outline-none cursor-pointer disabled:cursor-not-allowed"
            >
              <option value={INHERIT}>inherit ({r.defaultEffort})</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </td>
        <td className="pl-2 py-0.5 font-mono text-gray-500 dark:text-gray-400">
          <span className={r.effectiveProvider === 'grok-build' ? 'text-purple-600 dark:text-purple-400' : r.effectiveProvider === 'grok-api' ? 'text-emerald-600 dark:text-emerald-400' : ''}>{r.effectiveProvider}</span>
          {' · '}{r.effectiveModel} · {r.effectiveEffort}
        </td>
      </tr>
    );
  };

  if (!loaded) return <div className="text-2xs text-gray-400 dark:text-gray-500">loading node profiles…</div>;

  return (
    <div data-testid="daemon-nodes-matrix">
    <table className="w-full text-2xs border-collapse">
      <thead>
        <tr className="text-gray-500 dark:text-gray-400 text-left">
          <th className="font-medium pr-2 py-0.5">node</th>
          <th className="font-medium px-2 py-0.5">provider</th>
          <th className="font-medium px-2 py-0.5">model</th>
          <th className="font-medium px-2 py-0.5">effort</th>
          <th className="font-medium pl-2 py-0.5">resolves to</th>
        </tr>
      </thead>
      {groups.length === 0 ? (
        <tbody>
          {rows.map((r) => renderRow(r))}
        </tbody>
      ) : (
        groups.map((g) => {
          const groupRows = rows.filter((r) => g.kinds.includes(r.kind));
          const isCollapsed = collapsed[g.key];
          return (
            <tbody key={g.key} data-testid={`node-group-${g.key}`}>
              <tr
                data-testid={`node-group-header-${g.key}`}
                className="cursor-pointer border-t border-gray-200 dark:border-gray-700"
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
              >
                <td colSpan={5} className="py-1 pr-2">
                  <span className="text-2xs">{isCollapsed ? '▸' : '▾'}</span>{' '}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{g.label}</span>{' '}
                  <span className="text-3xs text-gray-500 dark:text-gray-400">— {g.firesWhen}</span>
                  {groupRows.length === 0 && (
                    <span className="text-3xs italic text-gray-400 dark:text-gray-500"> (not configurable here)</span>
                  )}
                </td>
              </tr>
              {!isCollapsed && groupRows.map(renderRow)}
            </tbody>
          );
        })
      )}
    </table>
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        data-testid="node-profiles-broadcast"
        disabled={broadcasting}
        onClick={broadcast}
        title="Copy this project's per-provider + model + effort settings to every other project (replaces theirs)"
        className="text-2xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      >
        {broadcasting ? 'pushing…' : 'Push to all projects'}
      </button>
      {broadcastMsg && <span className="text-2xs text-gray-500 dark:text-gray-400">{broadcastMsg}</span>}
    </div>
    </div>
  );
};

export default DaemonNodesMatrix;
