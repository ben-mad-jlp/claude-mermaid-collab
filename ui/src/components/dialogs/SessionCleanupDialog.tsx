/**
 * Session Cleanup Dialog
 *
 * Provides options for cleaning up a collab session:
 * - Archive: Copy to docs/designs/[session-name]/
 * - Delete: Remove without saving
 * - Keep: Leave session in place (cancel)
 * - Archive & Continue: Archive with timestamp, reset session
 */

import React, { useState } from 'react';
import type { Session } from '@/types';

export type CleanupAction = 'archive' | 'delete' | 'keep' | 'archive-continue';

interface SessionCleanupDialogProps {
  session: Session;
  onAction: (action: CleanupAction) => void;
  onClose: () => void;
  isProcessing?: boolean;
}

export const SessionCleanupDialog: React.FC<SessionCleanupDialogProps> = ({
  session,
  onAction,
  onClose,
  isProcessing = false,
}) => {
  const [selectedAction, setSelectedAction] = useState<CleanupAction | null>(null);

  const handleConfirm = () => {
    if (selectedAction) {
      onAction(selectedAction);
    }
  };

  const actions: { id: CleanupAction; label: string; description: string; icon: React.ReactNode }[] = [
    {
      id: 'archive',
      label: 'Archive',
      description: 'Save to docs/designs/ and remove session',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 8v13H3V8" />
          <path d="M1 3h22v5H1z" />
          <path d="M10 12h4" />
        </svg>
      ),
    },
    {
      id: 'delete',
      label: 'Delete',
      description: 'Remove session without saving',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
          <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      ),
    },
    {
      id: 'keep',
      label: 'Keep',
      description: 'Leave session in place',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
    },
    {
      id: 'archive-continue',
      label: 'Archive & Continue',
      description: 'Save with timestamp and reset session',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 8v13H3V8" />
          <path d="M1 3h22v5H1z" />
          <path d="M12 11v6" />
          <path d="M9 14l3-3 3 3" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Session Cleanup
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Choose what to do with <span className="font-medium">{session.name}</span>
          </p>
        </div>

        {/* Actions */}
        <div className="p-4 space-y-2">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => setSelectedAction(action.id)}
              disabled={isProcessing}
              className={`
                w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-colors
                ${selectedAction === action.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }
                ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <div className={`
                p-2 rounded-lg
                ${selectedAction === action.id
                  ? 'bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }
              `}>
                {action.icon}
              </div>
              <div className="flex-1 text-left">
                <div className={`
                  font-medium
                  ${selectedAction === action.id
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-gray-900 dark:text-white'
                  }
                `}>
                  {action.label}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {action.description}
                </div>
              </div>
              {selectedAction === action.id && (
                <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedAction || isProcessing}
            className={`
              px-4 py-2 text-sm font-medium rounded-lg transition-colors
              ${selectedAction && !isProcessing
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              }
            `}
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </span>
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionCleanupDialog;
