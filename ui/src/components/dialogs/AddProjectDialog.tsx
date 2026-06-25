/**
 * Add Project Dialog
 *
 * Prompts the user to add a project to a server. The path can be typed, picked via
 * the native OS folder dialog (desktop app), or chosen with the in-app folder browser
 * (plain browser). An optional "create new folder" mode mkdir's a named subfolder in
 * the selected parent and registers that.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '../../contexts/ServerContext';

interface AddProjectDialogProps {
  servers: ServerInfo[];
  defaultServerId: string;
  onSubmit: (serverId: string, path: string) => Promise<void>;
  onClose: () => void;
}

interface FsListResponse {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
}

/** In-app directory browser. Transport-agnostic: the caller supplies `list`,
 *  which lists a directory on the SELECTED server (a same-origin fetch for the
 *  local server, or an invokeOnServer call for a remote one) so this browses
 *  the right machine's filesystem rather than always the local box. */
const FolderBrowser: React.FC<{
  initialPath: string;
  serverLabel?: string;
  list: (path: string) => Promise<FsListResponse>;
  onPick: (path: string) => void;
  onClose: () => void;
}> = ({ initialPath, serverLabel, list, onPick, onClose }) => {
  const [cwd, setCwd] = useState(initialPath);
  const [data, setData] = useState<FsListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    list(cwd)
      .then((j) => {
        if (cancelled) return;
        setData(j);
        if (j.path !== cwd) setCwd(j.path); // server normalized (~, .., etc.)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, list]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          {serverLabel && (
            <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Browsing <span className="font-medium text-gray-700 dark:text-gray-300">{serverLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => data?.parent && setCwd(data.parent)}
              disabled={!data?.parent}
              className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Up one level"
            >
              ↑
            </button>
            <span className="flex-1 min-w-0 truncate font-mono text-xs text-gray-700 dark:text-gray-300" title={cwd}>{cwd}</span>
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-2">
          {loading && <div className="text-sm text-gray-500 px-2 py-1">Loading…</div>}
          {error && <div className="text-sm text-danger-600 dark:text-danger-400 px-2 py-1">{error}</div>}
          {!loading && !error && data?.entries.length === 0 && (
            <div className="text-sm text-gray-400 px-2 py-1">No subfolders</div>
          )}
          {data?.entries.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => setCwd(e.path)}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="text-gray-400">📁</span>
              <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400 self-center">Click a folder to open it.</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
            <button
              type="button"
              onClick={() => onPick(cwd)}
              className="px-3 py-1.5 text-sm rounded bg-info-600 text-white hover:bg-info-700"
            >
              Select this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AddProjectDialog: React.FC<AddProjectDialogProps> = ({
  servers,
  defaultServerId,
  onSubmit,
  onClose,
}) => {
  const [serverId, setServerId] = useState(defaultServerId);
  const [path, setPath] = useState('');
  const [createNew, setCreateNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const hasNativePicker = typeof (window as any).mc?.pickFolder === 'function';

  // Which server are we adding to, and is it remote? The native OS picker only
  // ever sees the LOCAL filesystem, so for a remote server we must browse over
  // the wire (invokeOnServer → the selected server's /api/fs/* endpoints).
  const selectedServer = servers.find((s) => s.id === serverId);
  const remote = !!selectedServer && selectedServer.source !== 'local';

  // List subfolders on the SELECTED server. Routed through invokeOnServer for a
  // remote server (so we browse the remote FS, with the token resolved in main);
  // a same-origin fetch for the local server / plain browser. Memoized on
  // (serverId, remote) so FolderBrowser's effect doesn't re-run every render.
  const browseList = useCallback(
    async (p: string): Promise<FsListResponse> => {
      const mc = (window as any).mc;
      if (mc?.invokeOnServer && remote) {
        const res = await mc.invokeOnServer(serverId, { path: '/api/fs/list', method: 'GET', query: { path: p } });
        const body = res?.body as (FsListResponse & { error?: string }) | string | undefined;
        if (!res?.ok) {
          throw new Error((body && typeof body === 'object' && body.error) || (typeof body === 'string' ? body : 'Failed to list folder'));
        }
        return body as FsListResponse;
      }
      const r = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}`);
      const j = (await r.json()) as FsListResponse & { error?: string };
      if (!r.ok) throw new Error(j.error || 'Failed to list folder');
      return j;
    },
    [serverId, remote],
  );

  // mkdir on the SELECTED server (same local/remote routing as browseList).
  const fsMkdir = async (parent: string, name: string): Promise<string> => {
    const mc = (window as any).mc;
    if (mc?.invokeOnServer && remote) {
      const res = await mc.invokeOnServer(serverId, { path: '/api/fs/mkdir', method: 'POST', body: { parent, name } });
      const body = res?.body as { path?: string; error?: string } | string | undefined;
      if (!res?.ok || !(body && typeof body === 'object' && body.path)) {
        throw new Error((body && typeof body === 'object' && body.error) || 'Failed to create folder');
      }
      return body.path;
    }
    const res = await fetch('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    });
    const j = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !j.path) throw new Error(j.error || 'Failed to create folder');
    return j.path;
  };

  const browse = async () => {
    const mc = (window as any).mc;
    // Native picker only knows the local FS — use it solely for the local server.
    // For a remote server, open the in-app browser pointed at that server.
    if (mc?.pickFolder && !remote) {
      try {
        const picked: string | null = await mc.pickFolder({ defaultPath: path || undefined });
        if (picked) setPath(picked);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Folder picker failed');
      }
    } else {
      setBrowserOpen(true);
    }
  };

  const handleSubmit = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError(createNew ? 'Parent folder is required' : 'Path is required');
      return;
    }
    if (!trimmed.startsWith('/')) {
      setError('Path must be absolute (start with /)');
      return;
    }
    if (createNew && !newName.trim()) {
      setError('New folder name is required');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let finalPath = trimmed;
      if (createNew) {
        try {
          finalPath = await fsMkdir(trimmed, newName.trim());
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to create folder');
          setBusy(false);
          return;
        }
      }
      await onSubmit(serverId, finalPath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project');
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && path.trim() && !busy && !browserOpen) {
      handleSubmit();
    } else if (e.key === 'Escape' && !browserOpen) {
      onClose();
    }
  };

  const canSubmit = path.trim().length > 0 && (!createNew || newName.trim().length > 0) && !busy;

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-info-500 focus:border-transparent outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4" onKeyDown={handleKeyDown}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Project</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Register a project directory on a server</p>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Server Select */}
          <div>
            <label htmlFor="add-project-server" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Server</label>
            <select
              id="add-project-server"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              disabled={busy}
              className={inputClass}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.label} ({s.host}:{s.port})</option>
              ))}
            </select>
          </div>

          {/* Path Input + Browse */}
          <div>
            <label htmlFor="add-project-path" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {createNew ? 'Parent folder' : 'Project Path'}
            </label>
            <div className="flex gap-2">
              <input
                id="add-project-path"
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                autoFocus
                disabled={busy}
                className={`${inputClass} font-mono text-sm`}
                placeholder={createNew ? '/absolute/path/to/parent' : '/absolute/path/to/project'}
              />
              <button
                type="button"
                onClick={browse}
                disabled={busy}
                className="shrink-0 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                title={remote ? `Browse folders on ${selectedServer?.label ?? 'this server'}` : hasNativePicker ? 'Choose a folder (native dialog)' : 'Browse folders'}
              >
                Browse…
              </button>
            </div>
          </div>

          {/* Create-new toggle */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 select-none">
              <input
                type="checkbox"
                checked={createNew}
                onChange={(e) => setCreateNew(e.target.checked)}
                disabled={busy}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Create a new folder in the selected folder
            </label>
            {createNew && (
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
                className={`${inputClass} font-mono text-sm`}
                placeholder="new-folder-name"
              />
            )}
          </div>

          {/* Error */}
          {error && <div className="text-sm text-danger-600 dark:text-danger-400">{error}</div>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              canSubmit ? 'bg-info-600 text-white hover:bg-info-700' : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          >
            {busy ? (createNew ? 'Creating…' : 'Adding…') : createNew ? 'Create & Add' : 'Add'}
          </button>
        </div>
      </div>

      {browserOpen && (
        <FolderBrowser
          initialPath={path.trim().startsWith('/') ? path.trim() : ''}
          serverLabel={remote ? selectedServer?.label : undefined}
          list={browseList}
          onPick={(p) => { setPath(p); setBrowserOpen(false); }}
          onClose={() => setBrowserOpen(false)}
        />
      )}
    </div>
  );
};

export default AddProjectDialog;
