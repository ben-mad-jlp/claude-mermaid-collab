/**
 * Create Session Dialog
 *
 * Prompts user for session name when creating a new collab session.
 */

import React, { useState } from 'react';

interface CreateSessionDialogProps {
  suggestedName: string;
  onConfirm: (name: string, useRenderUI: boolean) => void;
  onClose: () => void;
}

export const CreateSessionDialog: React.FC<CreateSessionDialogProps> = ({
  suggestedName,
  onConfirm,
  onClose,
}) => {
  const [sessionName, setSessionName] = useState(suggestedName);
  const [useRenderUI, setUseRenderUI] = useState(true);

  const handleConfirm = () => {
    if (sessionName.trim()) {
      onConfirm(sessionName.trim(), useRenderUI);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && sessionName.trim()) {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Create New Session
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Choose a name for your session
          </p>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Session Name Input */}
          <div>
            <label
              htmlFor="session-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Session Name
            </label>
            <input
              id="session-name"
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              autoFocus
              className="
                w-full px-3 py-2
                border border-gray-300 dark:border-gray-600
                rounded-lg
                bg-white dark:bg-gray-700
                text-gray-900 dark:text-white
                focus:ring-2 focus:ring-blue-500 focus:border-transparent
                outline-none
              "
              placeholder="Enter session name"
            />
          </div>

          {/* Browser UI Toggle */}
          <div className="mt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={useRenderUI}
                  onChange={(e) => setUseRenderUI(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-blue-500 transition-colors"></div>
                <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Browser UI for questions
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Disable to use console-based questions instead
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!sessionName.trim()}
            className={`
              px-4 py-2 text-sm font-medium rounded-lg transition-colors
              ${sessionName.trim()
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              }
            `}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateSessionDialog;
