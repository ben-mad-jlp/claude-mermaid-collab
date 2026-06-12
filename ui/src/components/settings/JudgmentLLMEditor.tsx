import { useState, useEffect, useCallback } from 'react';

type Provider = 'xai' | 'openai' | 'anthropic';

const PROVIDERS: Array<{ id: Provider; label: string; keyName: string; modelHint: string }> = [
  { id: 'xai', label: 'xAI (Grok)', keyName: 'XAI_API_KEY', modelHint: 'grok-build-0.1' },
  { id: 'openai', label: 'OpenAI', keyName: 'OPENAI_API_KEY', modelHint: 'gpt-4o' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyName: 'ANTHROPIC_API_KEY', modelHint: 'claude-sonnet-4-5' },
];

const DEFAULT_MODEL = 'grok-build-0.1';

/**
 * Judgment LLM editor — picks the daemon's swappable reasoning provider+model and
 * sets the matching API key. Provider → JUDGMENT_PROVIDER, model → JUDGMENT_MODEL,
 * and the key routes to the per-provider secret (XAI/OPENAI/ANTHROPIC_API_KEY).
 * All three persist to ~/.mermaid-collab/config.json via /api/settings/secrets,
 * the same store SecretsEditor uses. Defaults resolve to today's xAI behaviour.
 */
export function JudgmentLLMEditor() {
  const [provider, setProvider] = useState<Provider>('xai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = PROVIDERS.find(p => p.id === provider) ?? PROVIDERS[0];

  useEffect(() => {
    setLoading(true);
    fetch('/api/settings/secrets')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { secrets?: Record<string, string> };
        return data.secrets ?? {};
      })
      .then(secrets => {
        const p = (secrets.JUDGMENT_PROVIDER as Provider) || 'xai';
        const validProvider: Provider = PROVIDERS.some(x => x.id === p) ? p : 'xai';
        setProvider(validProvider);
        setModel(secrets.JUDGMENT_MODEL ?? '');
        const keyName = (PROVIDERS.find(x => x.id === validProvider) ?? PROVIDERS[0]).keyName;
        setApiKey(secrets[keyName] ?? '');
        setError(null);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const secrets: Record<string, string> = {
        JUDGMENT_PROVIDER: provider,
        JUDGMENT_MODEL: model.trim(),
        [current.keyName]: apiKey,
      };
      const res = await fetch('/api/settings/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets }),
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
  }, [provider, model, apiKey, current.keyName]);

  // When provider changes, reload the matching key from the server so we edit the
  // right secret (avoid POSTing a stale key under a new provider's name).
  const onProviderChange = useCallback((next: Provider) => {
    setProvider(next);
    setApiKey('');
    const keyName = (PROVIDERS.find(x => x.id === next) ?? PROVIDERS[0]).keyName;
    fetch('/api/settings/secrets')
      .then(r => r.ok ? r.json() : null)
      .then((data: { secrets?: Record<string, string> } | null) => {
        if (data?.secrets) setApiKey(data.secrets[keyName] ?? '');
      })
      .catch(() => { /* leave blank */ });
  }, []);

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 py-2">Loading…</div>;
  }

  return (
    <div data-testid="judgment-llm-editor" className="space-y-3 border-b border-gray-200 dark:border-gray-700 pb-6 mb-2">
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Daemon Judgment LLM</h3>
      <p role="note" className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded px-3 py-2">
        The reasoning model the Orchestrator daemon uses to triage escalations. Defaults to
        xAI <code className="font-mono">{DEFAULT_MODEL}</code>. Stored in
        {' '}<code className="font-mono">config.json</code>; takes effect immediately.
      </p>

      {error && <p role="alert" className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}

      <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
        <label htmlFor="judgment-provider" className="text-sm text-gray-700 dark:text-gray-300">Provider</label>
        <select
          id="judgment-provider"
          aria-label="Judgment provider"
          value={provider}
          onChange={e => onProviderChange(e.target.value as Provider)}
          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 outline-none"
        >
          {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <label htmlFor="judgment-model" className="text-sm text-gray-700 dark:text-gray-300">Model</label>
        <input
          id="judgment-model"
          type="text"
          aria-label="Judgment model"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder={current.modelHint}
          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 outline-none font-mono"
        />

        <label htmlFor="judgment-key" className="text-sm text-gray-700 dark:text-gray-300">{current.keyName}</label>
        <div className="flex items-center gap-1">
          <input
            id="judgment-key"
            type={revealed ? 'text' : 'password'}
            aria-label="Judgment API key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="value"
            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 outline-none font-mono"
          />
          <button
            type="button"
            onClick={() => setRevealed(v => !v)}
            aria-label={revealed ? 'Hide value' : 'Reveal value'}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && <span className="text-xs text-success-600 dark:text-success-400">Saved</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-info-600 text-white hover:bg-info-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default JudgmentLLMEditor;
