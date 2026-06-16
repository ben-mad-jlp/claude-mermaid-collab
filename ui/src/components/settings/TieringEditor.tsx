/**
 * TieringEditor — the worker-fabric model-routing matrix (design-worker-fabric-ui §2/
 * §6.8(5)). Rows = recipe phases; each shows the RESOLVED (provider/model) + the WHY
 * (winning scope from the server-side walk), a provider picker that writes a scoped
 * override (POST /api/tiering), and provider key-health. Reads /api/worker/route-preview
 * so the precedence is computed server-side once — the UI never re-derives the algorithm.
 */
import React from 'react';

const PHASES = ['sizegate', 'research', 'authortests', 'implement', 'verify', 'review'] as const;
const PROVIDERS = ['', 'claude', 'grok-build', 'codex'] as const; // '' = inherit (clear override)

interface PreviewRow {
  phase: string;
  provider: string;
  model: string;
  source: 'default' | 'override';
  winningScope?: string;
  available: boolean;
}
interface OverrideRow {
  scope: string;
  scopeId: string;
  phase: string;
  provider: string;
  model?: string | null;
}

const SCOPE_LABEL: Record<string, string> = { project: 'Project', epic: 'Epic', level: 'Level', global: 'Global' };

export const TieringEditor: React.FC<{
  /** 'project' | 'epic' | 'level'. (Global keys are edited in Settings → Secrets.) */
  scope: 'project' | 'epic' | 'level';
  scopeId: string;
  /** Used to compute the resolved-route preview (the walk needs project + epic + level). */
  previewParams?: { project?: string; epicId?: string; level?: string };
}> = ({ scope, scopeId, previewParams }) => {
  const [preview, setPreview] = React.useState<PreviewRow[]>([]);
  const [overrides, setOverrides] = React.useState<Record<string, OverrideRow>>({});
  const [keys, setKeys] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const qs = new URLSearchParams();
    if (previewParams?.project) qs.set('project', previewParams.project);
    if (previewParams?.epicId) qs.set('epicId', previewParams.epicId);
    if (previewParams?.level) qs.set('level', previewParams.level);
    try {
      const [pv, ov, kh] = await Promise.all([
        fetch(`/api/worker/route-preview?${qs}`).then((r) => r.json()),
        fetch(`/api/tiering?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`).then((r) => r.json()),
        fetch(`/api/worker/key-health`).then((r) => r.json()),
      ]);
      setPreview(pv.rows ?? []);
      const map: Record<string, OverrideRow> = {};
      for (const o of (ov.overrides ?? []) as OverrideRow[]) map[o.phase] = o;
      setOverrides(map);
      setKeys(kh ?? {});
    } catch { /* best-effort */ }
  }, [scope, scopeId, previewParams?.project, previewParams?.epicId, previewParams?.level]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const setOverrideFor = async (phase: string, provider: string, model?: string) => {
    setBusy(true);
    try {
      await fetch('/api/tiering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, scopeId, phase, provider, model: model ?? null }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-gray-700 dark:text-gray-200">Model routing — {SCOPE_LABEL[scope]} scope</span>
        <span className="text-gray-400 truncate" title={scopeId}>{scopeId}</span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="py-1 pr-2 font-medium">phase</th>
            <th className="py-1 pr-2 font-medium">override</th>
            <th className="py-1 pr-2 font-medium">resolves to</th>
            <th className="py-1 font-medium">why</th>
          </tr>
        </thead>
        <tbody>
          {PHASES.map((phase) => {
            const pv = preview.find((r) => r.phase === phase);
            const ov = overrides[phase];
            return (
              <tr key={phase} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-1 pr-2 text-gray-600 dark:text-gray-300">{phase}</td>
                <td className="py-1 pr-2">
                  <select
                    disabled={busy}
                    value={ov?.provider ?? ''}
                    onChange={(e) => void setOverrideFor(phase, e.target.value, undefined)}
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p || 'inherit'} value={p}>{p || '◦ inherit'}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2 tabular-nums text-gray-700 dark:text-gray-200">
                  {pv ? `${pv.provider}/${pv.model}` : '—'}
                  {pv && !pv.available && <span className="ml-1 text-warning-600" title="provider key missing → fell back">⚠</span>}
                </td>
                <td className="py-1 text-gray-400">
                  {pv?.winningScope === scope ? (
                    <span className="text-accent-600 dark:text-accent-400">▸ {pv.winningScope}</span>
                  ) : pv?.source === 'override' ? (
                    <span>↑ {pv?.winningScope}</span>
                  ) : (
                    <span className="opacity-60">default</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 flex items-center gap-3 text-gray-500">
        <span className="font-medium">keys:</span>
        {['claude', 'grok-build', 'codex'].map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${keys[p] ? 'bg-success-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            {p}{!keys[p] && p !== 'codex' ? ' (no key)' : ''}
          </span>
        ))}
        <span className="ml-auto text-gray-400 italic">set keys in Settings → Secrets</span>
      </div>
    </div>
  );
};

export default TieringEditor;
