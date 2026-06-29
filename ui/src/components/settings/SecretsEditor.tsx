import { useState, useEffect, useCallback, useMemo } from 'react';
import { useServers } from '@/contexts/ServerContext';
import { useSession } from '@/hooks/useSession';

interface SecretRow { id: string; key: string; value: string }

/** Secrets we know the server reads via the config service — pre-seeded as rows. */
const KNOWN_SECRET_KEYS = ['XAI_API_KEY'];

function randomId() {
  return Math.random().toString(36).slice(2);
}

/**
 * Route an API call to a SPECIFIC server (local or a remote peer) via the
 * desktop bridge's invokeOnServer, falling back to a same-origin fetch in the
 * browser-only deployment (no bridge → only the local server exists). This is
 * what makes the Secrets editor write to the machine the user picks: secrets
 * live in each server's own ~/.mermaid-collab/config.json, and consult_grok
 * reads them from the box the session runs on — so a remote session needs the
 * key on the remote, not on the local UI host.
 */
async function apiGet(serverId: string, path: string): Promise<{ ok: boolean; body: any }> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) {
    const res = await mc.invokeOnServer(serverId, { path, method: 'GET' });
    return { ok: !!res?.ok, body: res?.body ?? {} };
  }
  const r = await fetch(path);
  return { ok: r.ok, body: r.ok ? await r.json() : {} };
}
async function apiPost(serverId: string, path: string, body: unknown): Promise<{ ok: boolean; body: any }> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) {
    const res = await mc.invokeOnServer(serverId, { path, method: 'POST', body });
    return { ok: !!res?.ok, body: res?.body ?? {} };
  }
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, body: r.ok ? await r.json() : {} };
}

/**
 * Secrets / API Keys editor — reads and writes a chosen server's
 * ~/.mermaid-collab/config.json via the config service (GET/POST
 * /api/settings/secrets), routed through invokeOnServer so it targets the
 * selected machine (defaults to the active session's server). Saved values
 * refresh that server's config cache, so a subsequent consult_grok call there
 * picks up a new XAI_API_KEY with no file edit and no app restart.
 */
export function SecretsEditor() {
  const { servers } = useServers();
  const { currentSession } = useSession();

  // Target server for read/write. Default to the active session's server so the
  // common case ("I'm chatting with a remote agent, set ITS key") just works.
  // A falsy session serverId means the local origin → id 'local'.
  const defaultServerId = currentSession?.serverId || 'local';
  const [serverId, setServerId] = useState<string>(defaultServerId);

  // Options: the enumerated servers, guaranteeing a 'local' entry exists even
  // before the bridge has reported any (browser-only mode, or pre-probe).
  const serverOptions = useMemo(() => {
    const opts = servers.map((s) => ({ id: s.id, label: s.label, status: s.status }));
    if (!opts.some((o) => o.id === 'local')) opts.unshift({ id: 'local', label: 'Local', status: 'online' as const });
    // Surface the active session's server even if it isn't in the probed list yet.
    if (defaultServerId !== 'local' && !opts.some((o) => o.id === defaultServerId)) {
      opts.push({ id: defaultServerId, label: defaultServerId, status: 'connecting' as const });
    }
    return opts;
  }, [servers, defaultServerId]);

  const [rows, setRows] = useState<SecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // (Re)load the selected server's secrets whenever the target changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet(serverId, '/api/settings/secrets')
      .then(({ ok, body }) => {
        if (!ok) throw new Error((body && body.error) || 'Request failed');
        const secrets = (body?.secrets ?? {}) as Record<string, string>;
        // Seed known keys first (so an unset XAI_API_KEY still shows a field),
        // then append any other stored secrets.
        const seeded = new Map<string, string>();
        for (const k of KNOWN_SECRET_KEYS) seeded.set(k, secrets[k] ?? '');
        for (const [k, v] of Object.entries(secrets)) seeded.set(k, v);
        if (cancelled) return;
        setRows(Array.from(seeded.entries()).map(([key, value]) => ({ id: randomId(), key, value })));
      })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverId]);

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
      const secrets = Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]));
      const { ok, body } = await apiPost(serverId, '/api/settings/secrets', { secrets });
      if (!ok || !body?.success) throw new Error(body?.error ?? 'Save failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [rows, serverId]);

  return (
    <div data-testid="secrets-editor" className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Secrets / API Keys</h3>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <span>Server</span>
          <select
            data-testid="secrets-server-select"
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 outline-none"
          >
            {serverOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}{o.status && o.status !== 'online' ? ` (${o.status})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p role="note" className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded px-3 py-2">
        Stored in <code className="font-mono">~/.mermaid-collab/config.json</code> on the selected
        server — secrets are per-machine. A session reads them from the box it runs on (e.g.{' '}
        <code className="font-mono">consult_grok</code> needs <code className="font-mono">XAI_API_KEY</code>{' '}
        on that session's server). Saved keys take effect immediately — no app restart needed.
      </p>

      {error && (
        <p role="alert" className="text-xs text-danger-600 dark:text-danger-400">{error}</p>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
      ) : (
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
              aria-label="Secret name"
              value={key}
              onChange={e => updateRow(id, 'key', e.target.value)}
              placeholder="XAI_API_KEY"
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 outline-none"
            />
            <input
              type={revealed[id] ? 'text' : 'password'}
              aria-label="Secret value"
              value={value}
              onChange={e => updateRow(id, 'value', e.target.value)}
              placeholder="value"
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 outline-none font-mono"
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRevealed(s => ({ ...s, [id]: !s[id] }))}
                aria-label={revealed[id] ? 'Hide value' : 'Reveal value'}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
              >
                {revealed[id] ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                onClick={() => removeRow(id)}
                aria-label="Remove secret"
                className="p-1 text-gray-400 hover:text-danger-500 dark:hover:text-danger-400"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 4L4 12M4 4l8 8" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={addRow}
          className="text-sm text-info-600 dark:text-info-400 hover:underline"
        >
          + Add secret
        </button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-success-600 dark:text-success-400">Saved</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-info-600 text-white hover:bg-info-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SecretsEditor;
