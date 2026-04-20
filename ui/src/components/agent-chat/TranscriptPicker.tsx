import React, { useEffect, useState } from 'react';

export interface TranscriptSession {
  sessionId: string;
  startedAt?: string;
  firstUserMessage?: string;
  turnCount: number;
  model?: string;
  lastModifiedAt: number;
}

export interface TranscriptPickerProps {
  project: string;
  onSelect: (sessionId: string) => void;
  onDismiss: () => void;
}

function formatRelative(iso?: string): string {
  if (!iso) return 'unknown';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(day / 365);
  return `${yr}y ago`;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

/**
 * Modal picker listing prior Claude Code session transcripts for a project.
 * Fetches /api/agent/sessions?project={project} on mount.
 */
export const TranscriptPicker: React.FC<TranscriptPickerProps> = ({
  project,
  onSelect,
  onDismiss,
}) => {
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agent/sessions?project=${encodeURIComponent(project)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TranscriptSession[]) => {
        if (!cancelled) {
          setSessions(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-label="Select prior session transcript"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onDismiss}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Prior sessions
          </h2>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="px-2 py-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
              Loading…
            </div>
          )}
          {error && (
            <div className="p-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {!loading && !error && sessions.length === 0 && (
            <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
              No prior sessions found.
            </div>
          )}
          {!loading && !error && sessions.length > 0 && (
            <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
              {sessions.map((s) => (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    role="button"
                    onClick={() => onSelect(s.sessionId)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-100 dark:focus:bg-gray-800 focus:outline-none"
                  >
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <span className="font-mono">{s.sessionId.slice(0, 8)}</span>
                      <span>·</span>
                      <span>{formatRelative(s.startedAt)}</span>
                      <span>·</span>
                      <span>{s.turnCount} turns</span>
                      {s.model && (
                        <>
                          <span>·</span>
                          <span className="truncate">{s.model}</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-900 dark:text-gray-100 truncate">
                      {truncate(s.firstUserMessage, 80) || (
                        <span className="italic text-gray-400">(no message)</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default TranscriptPicker;
