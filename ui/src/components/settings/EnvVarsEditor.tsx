import { useState, useEffect, useCallback } from 'react';

interface EnvRow { id: string; key: string; value: string }

interface EnvVarsEditorProps {
  project: string;
}

function randomId() {
  return Math.random().toString(36).slice(2);
}

export function EnvVarsEditor({ project }: EnvVarsEditorProps) {
  const [rows, setRows] = useState<EnvRow[]>([{ id: randomId(), key: '', value: '' }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/code/file?project=${encodeURIComponent(project)}&path=.claude/settings.local.json`)
      .then(async r => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { content?: string };
        return data.content ? JSON.parse(data.content) as Record<string, unknown> : null;
      })
      .then(parsed => {
        const env = (parsed?.env ?? {}) as Record<string, string>;
        const entries = Object.entries(env);
        setRows(
          entries.length > 0
            ? entries.map(([k, v]) => ({ id: randomId(), key: k, value: v }))
            : [{ id: randomId(), key: '', value: '' }]
        );
        setError(null);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [project]);

  const addRow = useCallback(() => {
    setRows(r => [...r, { id: randomId(), key: '', value: '' }]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows(r => r.filter(row => row.id !== id));
  }, []);

  const updateRow = useCallback((id: string, field: 'key' | 'value', val: string) => {
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: val } : row));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const env = Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]));
      const res = await fetch('/api/settings/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, env }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [project, rows]);

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>;
  }

  return (
    <div data-testid="env-vars-editor" className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Environment Variables</h3>
      </div>

      <p role="note" className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-3 py-2">
        Changes take effect after restarting your Claude Code session.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 px-1">
          <span>Key</span>
          <span>Value</span>
          <span />
        </div>
        {rows.map(({ id, key, value }) => (
          <div key={id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <input
              type="text"
              aria-label="Variable name"
              value={key}
              onChange={e => updateRow(id, 'key', e.target.value)}
              placeholder="CLAUDE_CODE_..."
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              type="text"
              aria-label="Variable value"
              value={value}
              onChange={e => updateRow(id, 'value', e.target.value)}
              placeholder="value"
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="button"
              onClick={() => removeRow(id)}
              aria-label="Remove variable"
              className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 4L4 12M4 4l8 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={addRow}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          + Add variable
        </button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-600 dark:text-green-400">Saved</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EnvVarsEditor;
