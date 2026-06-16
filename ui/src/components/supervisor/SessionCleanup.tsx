/**
 * SessionCleanup — recommend + clean up stale collab sessions and orphan tmuxes.
 *
 * Reads GET /api/maintenance/stale-scan?days=N (which only ever recommends sessions
 * that are NOT live-bound and hold no in-progress work, and tmuxes with no attached
 * client + stale activity). Cleanup is explicit and per-item: archive a session
 * (POST /api/sessions/archive — with the user's archive OPTIONS) or kill a tmux
 * (POST /api/maintenance/kill-tmux). Rescans after each action.
 */
import React, { useCallback, useEffect, useState } from 'react';

interface StaleSession {
  project: string;
  session: string;
  lastAccess: string;
  ageDays: number;
  reason: string;
}
interface OrphanTmux {
  name: string;
  ageDays: number;
  reason: string;
}
interface StaleScan {
  days: number;
  sessions: StaleSession[];
  tmuxes: OrphanTmux[];
}

const DAY_OPTIONS = [7, 14, 30, 60, 90];

function basename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export const SessionCleanup: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [days, setDays] = useState(30);
  const [scan, setScan] = useState<StaleScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Archive options (the choices archiveSession exposes), applied to session archives.
  const [deleteAfter, setDeleteAfter] = useState(true);
  const [timestamp, setTimestamp] = useState(false);

  const rescan = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/stale-scan?days=${d}`);
      if (!res.ok) throw new Error(`scan failed (${res.status})`);
      setScan(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'scan failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void rescan(days);
  }, [days, rescan]);

  const archive = async (s: StaleSession) => {
    setBusy(`s:${s.project}/${s.session}`);
    try {
      await fetch('/api/sessions/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: s.project, session: s.session, deleteSession: deleteAfter, timestamp }),
      });
      await rescan(days);
    } finally {
      setBusy(null);
    }
  };

  const killTmux = async (t: OrphanTmux) => {
    setBusy(`t:${t.name}`);
    try {
      await fetch('/api/maintenance/kill-tmux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t.name }),
      });
      await rescan(days);
    } finally {
      setBusy(null);
    }
  };

  const sessions = scan?.sessions ?? [];
  const tmuxes = scan?.tmuxes ?? [];

  return (
    <div
      data-testid="session-cleanup"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[40rem] max-w-[92vw] max-h-[80vh] flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">🧹 Session cleanup</span>
          <label className="ml-auto flex items-center gap-1 text-2xs text-gray-500 dark:text-gray-400">
            idle ≥
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1 py-0.5 text-2xs"
            >
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}d</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void rescan(days)} className="text-2xs px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="Rescan">↻</button>
          <button type="button" onClick={onClose} className="text-2xs px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">✕</button>
        </div>

        {/* Archive options */}
        <div className="shrink-0 flex flex-wrap items-center gap-4 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-2xs text-gray-600 dark:text-gray-300">
          <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">Archive options</span>
          <label className="flex items-center gap-1 cursor-pointer" title="Copy artifacts to docs/designs/ then delete the session folder. Off = keep the session too.">
            <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} className="h-3 w-3" />
            Delete session after archiving
          </label>
          <label className="flex items-center gap-1 cursor-pointer" title="Append a timestamp to the archive folder name (avoids collisions / keeps versions).">
            <input type="checkbox" checked={timestamp} onChange={(e) => setTimestamp(e.target.checked)} className="h-3 w-3" />
            Timestamp archive folder
          </label>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-xs text-gray-400 dark:text-gray-500 italic">Scanning…</p>}
          {error && <p className="text-xs text-danger-500">{error}</p>}

          {!loading && !error && (
            <>
              {/* Stale sessions */}
              <section>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Stale sessions</span>
                  <span className="text-2xs text-gray-400">{sessions.length}</span>
                </div>
                {sessions.length === 0 ? (
                  <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No stale sessions — nothing idle past {days}d.</p>
                ) : (
                  <div className="space-y-1">
                    {sessions.map((s) => (
                      <div key={`${s.project}/${s.session}`} className="flex items-center gap-2 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">
                        <span className="min-w-0 flex-1 truncate text-2xs text-gray-700 dark:text-gray-200" title={`${s.project} / ${s.session}`}>
                          <span className="text-gray-400 dark:text-gray-500">{basename(s.project)} /</span> {s.session}
                        </span>
                        <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500">{s.reason}</span>
                        <button
                          type="button"
                          disabled={busy === `s:${s.project}/${s.session}`}
                          onClick={() => void archive(s)}
                          className="shrink-0 text-3xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                          title={deleteAfter ? 'Archive artifacts to docs/designs/ then delete the session' : 'Archive artifacts (keep the session)'}
                        >
                          {deleteAfter ? 'Archive + delete' : 'Archive'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Orphan tmuxes */}
              <section>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Orphan tmuxes</span>
                  <span className="text-2xs text-gray-400">{tmuxes.length}</span>
                </div>
                {tmuxes.length === 0 ? (
                  <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No orphan tmuxes — all have a client or recent activity.</p>
                ) : (
                  <div className="space-y-1">
                    {tmuxes.map((t) => (
                      <div key={t.name} className="flex items-center gap-2 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">
                        <span className="min-w-0 flex-1 truncate text-2xs font-mono text-gray-700 dark:text-gray-200" title={t.name}>{t.name}</span>
                        <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500">{t.reason}</span>
                        <button
                          type="button"
                          disabled={busy === `t:${t.name}`}
                          onClick={() => void killTmux(t)}
                          className="shrink-0 text-3xs px-1.5 py-0.5 rounded bg-danger-50 text-danger-600 hover:bg-danger-100 dark:bg-danger-900/30 dark:text-danger-300 disabled:opacity-50"
                          title="Kill this tmux session"
                        >
                          Kill
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionCleanup;
