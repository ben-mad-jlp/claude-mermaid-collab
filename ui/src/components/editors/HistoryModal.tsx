/**
 * HistoryModal Component
 *
 * A modal overlay showing the diff between historical and current content.
 * Features:
 * - Escape key to close
 * - Backdrop click to close
 * - Body scroll prevention when open
 * - Relative time display for historical version
 * - DiffView for showing content changes
 */

import React, { useEffect, useId } from 'react';
import { DiffView } from '@/components/ai-ui/display/DiffView';
import type { HistoryModalProps } from '@/types/history';

/**
 * Formats ISO timestamp to relative time string
 * Examples: "just now", "5m ago", "2h ago", "Yesterday", "3d ago"
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else {
    return `${diffDays}d ago`;
  }
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  historicalContent,
  currentContent,
  timestamp,
  documentName,
}) => {
  const id = useId();
  const titleId = `${id}-title`;

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        data-testid="history-modal-backdrop"
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className="relative z-50 bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="history-modal-content"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col">
            <h2
              id={titleId}
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Version History
              {documentName && (
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                  - {documentName}
                </span>
              )}
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {formatRelativeTime(timestamp)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          <DiffView
            before={historicalContent}
            after={currentContent}
            fileName={documentName}
          />
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700"
          data-testid="history-modal-footer"
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

HistoryModal.displayName = 'HistoryModal';

export default HistoryModal;
