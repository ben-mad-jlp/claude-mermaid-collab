/**
 * FlagsList Component
 *
 * Flags table with headers and rows for displaying flags.
 */

import React, { useState } from 'react';
import type { Flag } from '../../types';
import { FlagRow } from './FlagRow';
import { ConfirmDialog } from '../common/ConfirmDialog';

export interface FlagsListProps {
  /** List of flags to display */
  flags: Flag[];
  /** Resolve a flag */
  onResolve: (flagId: number, resolvedBy: string) => Promise<void>;
  /** Dismiss a flag */
  onDismiss: (flagId: number, dismissedBy: string, reason?: string) => Promise<void>;
  /** Reopen a flag */
  onReopen: (flagId: number, reopenedBy: string) => Promise<void>;
  /** Navigate to topic */
  onGoToTopic: (topicName: string) => void;
}

interface DialogState {
  type: 'dismiss' | null;
  flagId: number | null;
}

/**
 * FlagsList component - Table of flags
 */
export const FlagsList: React.FC<FlagsListProps> = ({
  flags,
  onResolve,
  onDismiss,
  onReopen,
  onGoToTopic,
}) => {
  const [dialogState, setDialogState] = useState<DialogState>({
    type: null,
    flagId: null,
  });
  const [dismissReason, setDismissReason] = useState('');

  const handleAction = async (
    flagId: number,
    action: 'resolve' | 'dismiss' | 'reopen',
    reason?: string
  ) => {
    const currentUser = 'current-user'; // Would come from auth context

    switch (action) {
      case 'resolve':
        await onResolve(flagId, currentUser);
        break;
      case 'dismiss':
        // Show dialog for dismiss
        setDialogState({ type: 'dismiss', flagId });
        break;
      case 'reopen':
        await onReopen(flagId, currentUser);
        break;
    }
  };

  const handleDismissConfirm = async () => {
    if (dialogState.flagId !== null) {
      const currentUser = 'current-user'; // Would come from auth context
      await onDismiss(dialogState.flagId, currentUser, dismissReason || undefined);
      setDialogState({ type: null, flagId: null });
      setDismissReason('');
    }
  };

  const handleDismissCancel = () => {
    setDialogState({ type: null, flagId: null });
    setDismissReason('');
  };

  // Empty state
  if (flags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700">
          <svg
            className="w-6 h-6 text-gray-400 dark:text-gray-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            No flags found
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            There are no flags matching your current filters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Topic
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Comment
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {flags.map((flag) => (
              <FlagRow
                key={flag.id}
                flag={flag}
                onAction={(action, reason) => handleAction(flag.id, action, reason)}
                onGoToTopic={() => onGoToTopic(flag.topicName)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Dismiss Confirmation Dialog */}
      <ConfirmDialog
        open={dialogState.type === 'dismiss'}
        title="Dismiss Flag"
        message="Are you sure you want to dismiss this flag? You can optionally provide a reason."
        confirmLabel="Dismiss"
        cancelLabel="Cancel"
        onConfirm={handleDismissConfirm}
        onCancel={handleDismissCancel}
        showReasonInput
        reasonValue={dismissReason}
        onReasonChange={setDismissReason}
      />
    </>
  );
};

export default FlagsList;
