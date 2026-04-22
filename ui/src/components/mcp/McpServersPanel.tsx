import { useState } from 'react';
import { useMcpServers, type McpServer } from '../../hooks/useMcpServers';

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok:           'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    unreachable:  'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    unauthorized: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    configured:   'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };
  const labels: Record<string, string> = {
    ok: 'OK', unreachable: 'Unreachable', unauthorized: 'Unauthorized', configured: 'Configured',
  };
  const cls = styles[status] ?? styles.configured;
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${cls}`}>
      {labels[status] ?? status}
    </span>
  );
}

function formatCost(cost?: number): string {
  if (cost == null) return '—';
  return `$${cost.toFixed(4)}`;
}

export function McpServersPanel({ onAdd }: { onAdd?: () => void }) {
  const { servers, loading, error, refetch } = useMcpServers();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleTest(server: McpServer) {
    setTestingId(server.id);
    setActionError(null);
    try {
      await fetch(`/api/mcp/servers/${encodeURIComponent(server.name)}/test`, { method: 'POST' });
      refetch();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setTestingId(null);
    }
  }

  async function handleRemove(server: McpServer) {
    setMenuId(null);
    setActionError(null);
    try {
      await fetch(`/api/mcp/servers?name=${encodeURIComponent(server.name)}`, { method: 'DELETE' });
      refetch();
    } catch (e) {
      setActionError(String(e));
    }
  }

  return (
    <div data-testid="mcp-servers-panel" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">MCP Servers</h3>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            + Add server
          </button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>
      )}

      {loading && (
        <div className="space-y-2 animate-pulse">
          {[1, 2].map(i => <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />)}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load: {error.message}</p>
      )}

      {!loading && !error && servers.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No MCP servers configured.</p>
      )}

      {!loading && !error && servers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium text-right">Token Cost</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server, idx) => (
                <tr
                  key={server.id}
                  className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${idx % 2 === 1 ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}
                >
                  <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200">{server.name}</td>
                  <td className="py-2 pr-3"><StatusChip status={server.status} /></td>
                  <td className="py-2 pr-3 text-right text-gray-600 dark:text-gray-400 font-mono text-xs">
                    {formatCost(server.tokenCost)}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTest(server)}
                        disabled={testingId === server.id}
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                      >
                        {testingId === server.id ? 'Testing…' : 'Test'}
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setMenuId(menuId === server.id ? null : server.id)}
                          aria-label="Server actions"
                          className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          ⋮
                        </button>
                        {menuId === server.id && (
                          <div className="absolute right-0 top-full mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-24">
                            <button
                              type="button"
                              onClick={() => handleRemove(server)}
                              className="w-full text-left text-sm px-3 py-2 text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default McpServersPanel;
