/**
 * Add Project Dialog
 *
 * Prompts user to add a project to a server by providing an absolute path.
 */

import React, { useState } from 'react';
import type { ServerInfo } from '../../contexts/ServerContext';

interface AddProjectDialogProps {
  servers: ServerInfo[];
  defaultServerId: string;
  onSubmit: (serverId: string, path: string) => Promise<void>;
  onClose: () => void;
}

export const AddProjectDialog: React.FC<AddProjectDialogProps> = ({
  servers,
  defaultServerId,
  onSubmit,
  onClose,
}) => {
  const [serverId, setServerId] = useState(defaultServerId);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError('Path is required');
      return;
    }
    if (!trimmed.startsWith('/')) {
      setError('Path must be absolute (start with /)');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(serverId, trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project');
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && path.trim() && !busy) {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const canSubmit = path.trim().length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Add Project
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Register a project directory on a server
          </p>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Server Select */}
          <div>
            <label
              htmlFor="add-project-server"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Server
            </label>
            <select
              id="add-project-server"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              disabled={busy}
              className="
                w-full px-3 py-2
                border border-gray-300 dark:border-gray-600
                rounded-lg
                bg-white dark:bg-gray-700
                text-gray-900 dark:text-white
                focus:ring-2 focus:ring-info-500 focus:border-transparent
                outline-none
              "
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.host}:{s.port})
                </option>
              ))}
            </select>
          </div>

          {/* Path Input */}
          <div>
            <label
              htmlFor="add-project-path"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Project Path
            </label>
            <input
              id="add-project-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoFocus
              disabled={busy}
              className="
                w-full px-3 py-2
                border border-gray-300 dark:border-gray-600
                rounded-lg
                bg-white dark:bg-gray-700
                text-gray-900 dark:text-white
                focus:ring-2 focus:ring-info-500 focus:border-transparent
                outline-none
                font-mono text-sm
              "
              placeholder="/absolute/path/to/project"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-danger-600 dark:text-danger-400">
              {error}
            </div>
          )}
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
            className={`
              px-4 py-2 text-sm font-medium rounded-lg transition-colors
              ${canSubmit
                ? 'bg-info-600 text-white hover:bg-info-700'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              }
            `}
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddProjectDialog;
