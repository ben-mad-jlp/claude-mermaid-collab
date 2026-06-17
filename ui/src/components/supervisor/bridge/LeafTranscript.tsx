/**
 * LeafTranscript — renders the per-leaf SDK-session transcript (a8785f3d) captured
 * from the headless `claude -p` nodes. Fetches the parsed stream-json from
 * GET /api/leaf-executor/transcript/:leafId and renders it turn-by-turn: node
 * boundaries, assistant text + tool calls, tool results, and the final result.
 *
 * This is the FULL transcript — distinct from WorkerRunStrip's ledger summary
 * (per-node stats). { ran:false } → "no transcript yet" (older runs predate
 * capture, or the leaf hasn't executed).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface Entry {
  type?: string;
  subtype?: string;
  label?: string;
  durationMs?: number;
  exitCode?: number;
  result?: string;
  is_error?: boolean;
  message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown; content?: unknown }> };
  raw?: string;
}

interface TranscriptResponse {
  leafId: string;
  ran: boolean;
  entries?: Entry[];
  truncated?: boolean;
  totalLines?: number;
}

interface LeafTranscriptProps {
  leafId: string;
  project: string;
  serverId: string;
}

function summarizeInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.slice(0, 80);
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  } catch { return ''; }
}

export const LeafTranscript: React.FC<LeafTranscriptProps> = ({ leafId, project, serverId }) => {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(serverId, `/api/leaf-executor/transcript/${encodeURIComponent(leafId)}?project=${encodeURIComponent(project)}`);
      const body = r.ok ? ((await r.json()) as TranscriptResponse) : null;
      setData(body ?? { leafId, ran: false });
    } catch {
      setData({ leafId, ran: false });
    } finally {
      setLoading(false);
    }
  }, [serverId, leafId, project]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="text-2xs text-gray-400 px-2 py-1">Loading transcript…</div>;
  if (!data || !data.ran || !data.entries?.length) {
    return <div className="text-2xs text-gray-400 dark:text-gray-500 px-2 py-1">No transcript captured for this leaf yet.</div>;
  }

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 max-h-96 overflow-y-auto text-2xs font-mono">
      {data.truncated && (
        <div className="px-2 py-1 text-amber-700 dark:text-amber-400 border-b border-gray-200 dark:border-gray-700">
          Showing the last {data.entries.length} of {data.totalLines} lines.
        </div>
      )}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {data.entries.map((e, i) => {
          if (e.type === 'node-boundary') {
            return (
              <div key={i} className="px-2 py-1 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 font-semibold sticky top-0">
                ▸ {e.label}{e.durationMs != null ? ` · ${Math.round(e.durationMs / 1000)}s` : ''}{e.exitCode != null && e.exitCode !== 0 ? ` · exit ${e.exitCode}` : ''}
              </div>
            );
          }
          if (e.type === 'assistant') {
            const blocks = e.message?.content ?? [];
            return (
              <div key={i} className="px-2 py-1">
                {blocks.map((b, j) => {
                  if (b.type === 'text' && b.text) return <div key={j} className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{b.text}</div>;
                  if (b.type === 'tool_use') return <div key={j} className="text-info-700 dark:text-info-400">🔧 {b.name}({summarizeInput(b.input)})</div>;
                  return null;
                })}
              </div>
            );
          }
          if (e.type === 'user') {
            const blocks = e.message?.content ?? [];
            const hasResult = blocks.some((b) => b.type === 'tool_result');
            if (hasResult) return <div key={i} className="px-2 py-0.5 text-gray-500 dark:text-gray-400">↳ tool result</div>;
            return null;
          }
          if (e.type === 'result') {
            return (
              <div key={i} className={`px-2 py-1 font-semibold ${e.is_error ? 'text-danger-600 dark:text-danger-400' : 'text-success-700 dark:text-success-400'}`}>
                {e.is_error ? '✗ result (error)' : '✓ result'}{e.result ? ` — ${e.result.slice(0, 200)}` : ''}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};
