import { useState, useEffect, useId } from 'react';

export interface AddMcpServerDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ToolPreview {
  name: string;
  description?: string;
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export function AddMcpServerDialog({ open, onClose, onSuccess }: AddMcpServerDialogProps) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'http'>('stdio');
  const [commandOrUrl, setCommandOrUrl] = useState('');
  const [auth, setAuth] = useState<'none' | 'oauth' | 'api-key'>('none');
  const [apiKey, setApiKey] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolPreview[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = name.trim() && commandOrUrl.trim() && !submitting;

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoverError(null);
    setTools(null);
    try {
      const res = await fetch('/api/mcp/servers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, command: type === 'stdio' ? commandOrUrl : undefined, url: type === 'http' ? commandOrUrl : undefined, auth, apiKey: auth === 'api-key' ? apiKey : undefined }),
      });
      const data = await res.json() as { tools?: ToolPreview[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTools(data.tools ?? []);
    } catch (e) {
      setDiscoverError(String(e));
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, command: type === 'stdio' ? commandOrUrl.trim() : undefined, url: type === 'http' ? commandOrUrl.trim() : undefined, auth, apiKey: auth === 'api-key' ? apiKey : undefined }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSuccess?.();
      onClose();
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="add-mcp-dialog-backdrop"
        className="fixed inset-0 z-50 bg-black bg-opacity-50"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="add-mcp-dialog"
          className="pointer-events-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
              Add MCP Server
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15 5L5 15M5 5l10 10" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Name</label>
              <input data-testid="add-mcp-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. my-tools" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select data-testid="add-mcp-type" value={type} onChange={e => setType(e.target.value as 'stdio' | 'http')} className={inputClass}>
                <option value="stdio">stdio (local command)</option>
                <option value="http">HTTP / SSE (remote URL)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{type === 'stdio' ? 'Command' : 'URL'}</label>
              <input
                data-testid="add-mcp-command"
                type="text"
                value={commandOrUrl}
                onChange={e => setCommandOrUrl(e.target.value)}
                placeholder={type === 'stdio' ? 'e.g. npx my-mcp-server' : 'e.g. https://api.example.com/mcp'}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Auth Method</label>
              <select data-testid="add-mcp-auth" value={auth} onChange={e => setAuth(e.target.value as 'none' | 'oauth' | 'api-key')} className={inputClass}>
                <option value="none">None</option>
                <option value="api-key">API Key</option>
                <option value="oauth">OAuth 2.0 PKCE</option>
              </select>
            </div>
            {auth === 'api-key' && (
              <div>
                <label className={labelClass}>API Key</label>
                <input data-testid="add-mcp-apikey" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." className={inputClass} />
              </div>
            )}
          </div>

          {/* Discover */}
          <div className="mt-4">
            <button
              type="button"
              data-testid="add-mcp-discover"
              onClick={handleDiscover}
              disabled={discovering || !name.trim() || !commandOrUrl.trim()}
              className="w-full py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {discovering ? 'Discovering…' : 'Discover tools'}
            </button>
            {discoverError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{discoverError}</p>}
            {tools !== null && (
              <div data-testid="add-mcp-tools-preview" className="mt-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1">
                {tools.length === 0
                  ? <p className="text-xs text-gray-500 dark:text-gray-400">No tools found.</p>
                  : tools.map(t => (
                      <div key={t.name} className="text-xs">
                        <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{t.name}</span>
                        {t.description && <span className="text-gray-500 dark:text-gray-400 ml-2">{t.description}</span>}
                      </div>
                    ))
                }
              </div>
            )}
          </div>

          {/* Footer */}
          {submitError && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{submitError}</p>}
          <div className="mt-5 flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              type="button"
              data-testid="add-mcp-cancel"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="add-mcp-submit"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add Server'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default AddMcpServerDialog;
