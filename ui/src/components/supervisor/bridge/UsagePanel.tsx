/**
 * UsagePanel — the Bridge "Usage" tab: token-usage statistics. Two things at a glance:
 *   1. Account rate-limit quota (the 5h / 7d meters, same as Zen/header) — "are we burning the plan".
 *   2. Per-source LLM burn over a window (GET /api/usage/burn), grouped by the pass that spent it
 *      (conductor / summary / triage / forge / … / node=build) — this is where a leak SHOWS: a daemon
 *      overhead source accruing calls with no work.
 *
 * Build sources (node/leaf/implement/review/…) are expected spend; the daemon-overhead rows are the
 * ones to watch. A slow poll (15s) runs only while the tab is mounted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiGet } from './useConductorEnabled';
import { UsageMeters } from '@/components/common/UsageBar';

interface BurnRow {
  source: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  estCostUsd: number;
}

interface UsagePanelProps {
  project: string;
  /** serverScope is accepted for parity with sibling panels; the burn endpoint is server-local. */
  serverScope?: string;
}

const WINDOWS: Array<{ label: string; ms: number }> = [
  { label: '1h', ms: 3_600_000 },
  { label: '24h', ms: 86_400_000 },
  { label: '7d', ms: 604_800_000 },
];

/** Build/leaf sources are expected spend — dim them so the daemon-overhead rows stand out. */
const BUILD_SOURCES = new Set(['node', 'leaf', 'implement', 'review', 'blueprint', 'verify', 'driveplan', 'driveexec', 'research', 'grok-node']);

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function fmtUsd(n: number): string {
  return n > 0 ? `$${n.toFixed(2)}` : '—';
}

export const UsagePanel: React.FC<UsagePanelProps> = ({ project }) => {
  const [windowMs, setWindowMs] = useState(3_600_000);
  const [rows, setRows] = useState<BurnRow[] | null>(null);
  const [scoped, setScoped] = useState(false); // false = fleet-wide, true = this project only

  const load = useCallback(async () => {
    const q = new URLSearchParams({ windowMs: String(windowMs) });
    if (scoped && project) q.set('project', project);
    const data = await apiGet(`/api/usage/burn?${q.toString()}`);
    setRows(Array.isArray(data?.sources) ? data.sources : []);
  }, [windowMs, scoped, project]);

  useEffect(() => {
    let alive = true;
    const run = async () => { await load(); };
    void run();
    const id = setInterval(() => { if (alive) void load(); }, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [load]);

  const totalCalls = (rows ?? []).reduce((s, r) => s + r.calls, 0);
  const totalUsd = (rows ?? []).reduce((s, r) => s + r.estCostUsd, 0);

  return (
    <div className="p-2" data-testid="usage-panel">
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Usage</span>
        <div className="ml-auto"><UsageMeters /></div>
      </div>

      {/* Controls: window + scope */}
      <div className="flex items-center gap-2 px-1 pb-2 text-3xs">
        <div className="flex items-center rounded overflow-hidden border border-gray-300 dark:border-gray-600">
          {WINDOWS.map((w, i) => (
            <button
              key={w.ms}
              type="button"
              onClick={() => setWindowMs(w.ms)}
              className={`px-2 py-0.5 ${i > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''} ${windowMs === w.ms ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setScoped((s) => !s)}
          title="Toggle between fleet-wide and this-project-only burn"
          className={`px-2 py-0.5 rounded border ${scoped ? 'bg-blue-500 text-white border-blue-500' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'}`}
        >
          {scoped ? 'this project' : 'all projects'}
        </button>
        <span className="ml-auto tabular-nums text-gray-500 dark:text-gray-400">
          {totalCalls} calls · est {fmtUsd(totalUsd)}
        </span>
      </div>

      {rows == null ? (
        <div className="px-1 py-6 text-center text-xs text-gray-500 dark:text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-1 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
          No LLM calls recorded in this window.
        </div>
      ) : (
        <table className="w-full text-3xs tabular-nums">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500 text-left">
              <th className="font-medium py-1 pl-1">source</th>
              <th className="font-medium py-1 text-right">calls</th>
              <th className="font-medium py-1 text-right">in</th>
              <th className="font-medium py-1 text-right">out</th>
              <th className="font-medium py-1 text-right">cache&nbsp;rd</th>
              <th className="font-medium py-1 text-right pr-1">est&nbsp;$</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const build = BUILD_SOURCES.has(r.source);
              return (
                <tr
                  key={r.source}
                  data-testid={`usage-row-${r.source}`}
                  title={build ? 'build/leaf spend (expected)' : 'daemon-overhead source — watch for leaks'}
                  className={`border-t border-gray-100 dark:border-gray-800 ${build ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100 font-medium'}`}
                >
                  <td className="py-1 pl-1">{r.source}</td>
                  <td className="py-1 text-right">{r.calls}</td>
                  <td className="py-1 text-right">{fmtTokens(r.inputTokens)}</td>
                  <td className="py-1 text-right">{fmtTokens(r.outputTokens)}</td>
                  <td className="py-1 text-right">{fmtTokens(r.cacheReadTokens)}</td>
                  <td className="py-1 text-right pr-1">{fmtUsd(r.estCostUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="px-1 pt-2 text-3xs text-gray-400 dark:text-gray-500 leading-snug">
        Dimmed rows are build/leaf spend (expected). Bold rows are daemon-overhead sources — a large
        <span className="font-medium"> calls</span> count there with no accepted work is a leak.
      </p>
    </div>
  );
};

export default UsagePanel;
