import React from 'react';
import { useSessionCost } from '../../hooks/useSessionCost';

export interface CostPanelProps {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}

export function CostPanel({ sessionId, open, onClose }: CostPanelProps) {
  const { totals, turns, loading, error } = useSessionCost(open ? sessionId : null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const totalCostUsd = totals?.totalCostUsd ?? 0;
  const inputTokens = totals?.totalInputTokens ?? 0;
  const outputTokens = totals?.totalOutputTokens ?? 0;
  const cacheRead = totals?.totalCacheReadTokens ?? 0;
  const cacheCreation = totals?.totalCacheCreationTokens ?? 0;

  const exportCsv = () => {
    if (!turns || turns.length === 0) return;
    const header = 'turn,ts,model,input,output,cacheRead,cacheCreate,costUsd';
    const rows = turns.map((t) =>
      [t.turn, t.ts, t.model ?? '', t.inputTokens, t.outputTokens, t.cacheRead, t.cacheCreate, t.costUsd].join(',')
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId ?? 'unknown'}-cost.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} aria-hidden />
      <aside
        data-testid="cost-panel"
        className="fixed inset-y-0 right-0 w-96 bg-background border-l shadow-lg z-50 flex flex-col"
        role="dialog"
        aria-label="Session cost details"
      >
        <header className="flex items-center justify-between p-3 border-b">
          <h2 className="text-base font-semibold">Cost</h2>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {error && <div className="text-sm text-red-500">Error: {error.message}</div>}
          <div className="text-3xl font-semibold tabular-nums">${totalCostUsd.toFixed(4)}</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Input tokens</dt><dd className="tabular-nums">{inputTokens.toLocaleString()}</dd>
            <dt className="text-muted-foreground">Output tokens</dt><dd className="tabular-nums">{outputTokens.toLocaleString()}</dd>
            <dt className="text-muted-foreground">Cache read</dt><dd className="tabular-nums">{cacheRead.toLocaleString()}</dd>
            <dt className="text-muted-foreground">Cache creation</dt><dd className="tabular-nums">{cacheCreation.toLocaleString()}</dd>
          </dl>
          {turns.length === 0 ? (
            <div className="text-sm text-muted-foreground pt-4">No usage yet.</div>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">#</th><th>Model</th><th>In</th><th>Out</th><th>$</th>
                </tr>
              </thead>
              <tbody>
                {turns.map((t) => (
                  <tr key={t.turn} className="border-t">
                    <td className="py-1">{t.turn}</td>
                    <td>{t.model ?? ''}</td>
                    <td>{t.inputTokens}</td>
                    <td>{t.outputTokens}</td>
                    <td>${(t.costUsd ?? 0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="p-3 border-t">
          <button type="button" onClick={exportCsv} disabled={turns.length === 0} className="text-sm px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">
            Export CSV
          </button>
        </footer>
      </aside>
    </>
  );
}

export default CostPanel;
