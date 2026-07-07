import { useState, useEffect, useCallback } from 'react';

interface ContextRecycleEditorProps {
  project: string;
}

type Mode = 'off' | 'notify' | 'force';

const OPTIONS: Array<{ id: Mode; label: string; detail: string }> = [
  { id: 'off', label: 'Off', detail: 'Record context only. The server never recycles this project’s sessions. (default)' },
  { id: 'notify', label: 'Notify', detail: 'At the threshold, nudge the session to run /vibe-checkpoint; the server clears + reloads (/collab) only once a fresh checkpoint is saved. Assisted — never forces the checkpoint.' },
  { id: 'force', label: 'Force', detail: 'Server drives the full macro: inject /vibe-checkpoint → /clear → /collab, no wait. For an unattended autonomous-loop session that won’t notice its own context filling.' },
];

export function ContextRecycleEditor({ project }: ContextRecycleEditorProps) {
  const [mode, setMode] = useState<Mode>('off');
  const [threshold, setThreshold] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supervisor/context-recycle?project=${encodeURIComponent(project)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ mode?: Mode; thresholdPercent?: number }>;
      })
      .then(data => {
        setMode(data.mode ?? 'off');
        setThreshold(data.thresholdPercent ?? null);
        setError(null);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [project]);

  const handleChange = useCallback(async (next: Mode) => {
    const prev = mode;
    setMode(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/supervisor/context-recycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, mode: next }),
      });
      const data = await res.json() as { ok?: boolean; mode?: Mode; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setMode(prev); // revert on failure
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [project, mode]);

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>;
  }

  return (
    <div data-testid="context-recycle-editor" className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Auto-recycle context</h3>
        {saved && <span className="text-xs text-success-600 dark:text-success-400">Saved</span>}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Keep a long-running watched session alive when its context fills: the server checkpoints it,
        clears it, and reloads it via /collab — no supervisor needed. Triggers at the watchdog
        threshold{threshold != null ? ` (currently ${threshold}%)` : ''}.
      </p>

      {error && (
        <p role="alert" className="text-xs text-danger-600 dark:text-danger-400">{error}</p>
      )}

      <div role="radiogroup" aria-label="Context auto-recycle mode" className="space-y-2">
        {OPTIONS.map(opt => (
          <label
            key={opt.id}
            className={`flex gap-3 items-start px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
              mode === opt.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <input
              type="radio"
              name="context-recycle-mode"
              value={opt.id}
              checked={mode === opt.id}
              disabled={saving}
              onChange={() => handleChange(opt.id)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-white">{opt.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.detail}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === 'force' && (
        <p role="note" className="text-xs text-warning-700 dark:text-warning-300 bg-warning-50 dark:bg-warning-950/40 border border-warning-200 dark:border-warning-800 rounded px-3 py-2">
          Force mode injects /clear into the session automatically. Intended for unattended
          autonomous-loop sessions — not one you’re actively typing in.
        </p>
      )}
    </div>
  );
}

export default ContextRecycleEditor;
