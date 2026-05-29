/**
 * ServersTreeSection — sidebar tree section listing known collab servers.
 *
 * Mirrors the affordances of ServerSwitcher (status dot, icon, label,
 * host:port, switch-on-click, manual add/remove) but rendered as a sidebar-
 * tree section above Watching. The header-mounted ServerSwitcher coexists
 * with this section until Wave 2's `header-remove-server-switcher` task
 * removes it; ServerSwitcher.tsx is deleted in Wave 3's cleanup.
 */
import React, { forwardRef, useState, useImperativeHandle } from 'react';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';

const STATUS_DOT: Record<string, string> = {
  online: '#3fb950',
  offline: '#6e7681',
  connecting: '#d29922',
};

export interface ServersTreeSectionProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export interface ServersTreeSectionHandle {
  revealAddForm: () => void;
}

const ServersTreeSection = forwardRef<ServersTreeSectionHandle, ServersTreeSectionProps>(
  (props, ref) => {
    const { available, servers, addServer, removeServer, recheckServer } = useServers();

    const [internalCollapsed, setInternalCollapsed] = useState(false);
    const isCollapsed = props.collapsed ?? internalCollapsed;
    const handleToggle = props.onToggle ?? (() => setInternalCollapsed((c) => !c));

    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ label: '', host: '', port: '9002', token: '' });
    const [error, setError] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      revealAddForm: () => setAdding(true),
    }), []);

    const submitAdd = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const port = Number(form.port);
      if (!form.label || !form.host || !Number.isFinite(port)) {
        setError('Label, host, and a numeric port are required');
        return;
      }
      if (!available) {
        setError('Adding servers requires the desktop app');
        return;
      }
      try {
        await addServer({ label: form.label, host: form.host, port, token: form.token || undefined });
        setForm({ label: '', host: '', port: '9002', token: '' });
        setAdding(false);
      } catch (err: any) {
        setError(err?.message ?? 'Failed to add server');
      }
    };

    const handleRemove = async (id: string) => {
      if (!available) return;
      try { await removeServer(id); } catch { /* surface in toast later */ }
    };

    return (
      <div data-testid="sidebar-servers-section" className="border-b border-gray-200 dark:border-gray-700">
        {/* Header — mirrors the Watching panel */}
        <div className="flex items-center">
          <button
            onClick={handleToggle}
            className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span>Servers</span>
            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
              {servers.length}
            </span>
            <svg
              className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {/* Add server button */}
          <button
            onClick={() => { if (isCollapsed) handleToggle(); setAdding(true); }}
            className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Add a server"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        {!isCollapsed && (
          <div className="px-2 pb-2 space-y-1">
            {servers.length === 0 && (
              <div className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
                No servers found
              </div>
            )}
            {servers.map((s) => {
              const isManual = s.source === 'manual';
              return (
                <div
                  key={s.id}
                  data-testid={`sidebar-server-row-${s.id}`}
                >
                  <div
                    className="relative group flex items-center gap-1.5 px-2 py-1 rounded text-xs text-gray-700 dark:text-gray-300"
                    title={s.label}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: STATUS_DOT[s.status] ?? STATUS_DOT.offline,
                        flexShrink: 0,
                      }}
                    />
                    <ServerIcon name={s.icon} size={14} title={`Server: ${s.label}`} />
                    <span className="flex-1 min-w-0 truncate">
                      {s.label || 'server'}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500 truncate">
                      {s.host}:{s.port}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void recheckServer(s.id); }}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 ${s.status === 'connecting' ? 'animate-spin opacity-100' : ''}`}
                      title="Recheck availability"
                      aria-label={`Recheck ${s.label}`}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {isManual ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleRemove(s.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                        title="Remove server"
                        aria-label={`Remove ${s.label}`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {adding && (
              <form onSubmit={submitAdd} className="px-2 py-1.5 grid gap-1.5">
                  <input
                    placeholder="Label"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <input
                    placeholder="Host (e.g. 192.168.1.20)"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <input
                    placeholder="Port"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <input
                    placeholder="Token (optional)"
                    type="password"
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  {error && <span className="text-xs text-red-500 dark:text-red-400">{error}</span>}
                  <div className="flex gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => { setAdding(false); setError(null); }}
                      className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Save &amp; Connect
                    </button>
                  </div>
              </form>
            )}
          </div>
        )}
      </div>
    );
  },
);

ServersTreeSection.displayName = 'ServersTreeSection';

export { ServersTreeSection };
export default ServersTreeSection;
