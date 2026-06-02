import React, { useEffect, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { AuditEntry } from '@/stores/supervisorStore';

export interface TracePanelProps {
  serverId: string;
  project: string;
}

// Visual treatment per audit kind (the unified orchestration trace).
const KIND_META: Record<string, { glyph: string; cls: string }> = {
  claim: { glyph: '◎', cls: 'text-info-600 dark:text-info-400' },
  spawn: { glyph: '✦', cls: 'text-indigo-600 dark:text-indigo-400' },
  complete: { glyph: '●', cls: 'text-success-600 dark:text-success-400' },
  nudge: { glyph: '➤', cls: 'text-gray-500 dark:text-gray-400' },
  checkpoint: { glyph: '⚑', cls: 'text-cyan-600 dark:text-cyan-400' },
  clear: { glyph: '⟳', cls: 'text-warning-600 dark:text-warning-400' },
  escalate: { glyph: '⚠', cls: 'text-danger-600 dark:text-danger-400' },
  override: { glyph: '⏻', cls: 'text-purple-600 dark:text-purple-400' },
};

const FILTERS = ['all', 'claim', 'spawn', 'complete', 'escalate', 'clear', 'checkpoint', 'nudge', 'override'] as const;
type Filter = typeof FILTERS[number];

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

function fmtTime(ts: number): string {
  try { return new Date(ts).toLocaleTimeString(); } catch { return String(ts); }
}

function TraceRow({ e }: { e: AuditEntry }) {
  const meta = KIND_META[e.kind] ?? { glyph: '·', cls: 'text-gray-400' };
  let detail = e.detail ?? '';
  try { const o = JSON.parse(e.detail ?? ''); detail = Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '); } catch { /* raw */ }
  return (
    <div className="flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 font-mono text-xs">
      <span className="shrink-0 text-gray-400 dark:text-gray-500 tabular-nums">{fmtTime(e.ts)}</span>
      <span className={`shrink-0 ${meta.cls}`} title={e.kind}>{meta.glyph}</span>
      <span className={`shrink-0 w-16 ${meta.cls}`}>{e.kind}</span>
      {e.session && <span className="shrink-0 text-gray-500 dark:text-gray-400 truncate max-w-[120px]">{e.session}</span>}
      <span className="flex-1 text-gray-600 dark:text-gray-300 break-all">{detail}</span>
    </div>
  );
}

/**
 * Trace panel (observability): a live, time-ordered view of the supervisor audit
 * log — the unified orchestration trace (claims, spawns, completions,
 * escalations, clears, checkpoints, nudges, overrides) for a project.
 */
export const TracePanel: React.FC<TracePanelProps> = ({ serverId, project }) => {
  const auditByProject = useSupervisorStore((s) => s.auditByProject);
  const loadAudit = useSupervisorStore((s) => s.loadAudit);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (serverId && project) void loadAudit(serverId, project);
  }, [serverId, project, loadAudit]);

  const all = auditByProject[project] ?? [];
  const entries = filter === 'all' ? all : all.filter((e) => e.kind === filter);

  return (
    <div className="flex flex-col h-full border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Trace</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">· {projectBasename(project)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void loadAudit(serverId, project)}
            className="px-2 py-0.5 text-xs rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Refresh"
          >
            ⟳
          </button>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 text-gray-600 dark:text-gray-300"
          >
            {FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400 dark:text-gray-500">No trace events{filter === 'all' ? '' : ` of kind "${filter}"`} for this project yet.</p>
          </div>
        ) : (
          <div className="p-1 space-y-0.5">
            {entries.map((e) => <TraceRow key={e.id} e={e} />)}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
        {entries.length} event{entries.length === 1 ? '' : 's'}{filter !== 'all' ? ` · ${filter}` : ''} · most-recent-first
      </div>
    </div>
  );
};

export default TracePanel;
