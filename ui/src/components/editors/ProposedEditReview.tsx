/**
 * ProposedEditReview Component
 *
 * Sticky banner that appears above the code editor when Claude has proposed
 * an edit to a linked code artifact via the `propose_code_edit` MCP tool.
 *
 * Shows the proposal message, a Preview Diff modal, and Accept/Reject buttons.
 * Accept updates envelope.code to the proposed content and marks the snippet
 * dirty (user still must Push to write to disk). Reject clears the proposal.
 */

import React, { useState, useEffect, useCallback } from 'react';
import DiffViewer from 'react-diff-viewer-continued';
import { useTheme } from '@/hooks/useTheme';

export interface ProposedEditReviewProps {
  currentCode: string;
  proposedCode: string;
  proposedMessage?: string;
  proposedAt: number;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60000) return 'just now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  return `${Math.floor(delta / 86400000)}d ago`;
}

export const ProposedEditReview: React.FC<ProposedEditReviewProps> = ({
  currentCode,
  proposedCode,
  proposedMessage,
  proposedAt,
  onAccept,
  onReject,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const handleAccept = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await onAccept();
    } finally {
      // Parent will unmount us on success (envelope.proposedEdit removed).
      // On error, re-enable buttons so user can retry.
      setIsProcessing(false);
    }
  }, [isProcessing, onAccept]);

  const handleReject = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await onReject();
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, onReject]);

  // Escape key closes the preview modal
  useEffect(() => {
    if (!previewOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewOpen]);

  const hasChanges = currentCode !== proposedCode;

  return (
    <>
      {/* Banner */}
      <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-amber-800 dark:text-amber-200 font-medium flex-shrink-0">
            Claude proposed an edit
          </span>
          {proposedMessage && (
            <>
              <span className="text-amber-600 dark:text-amber-400 flex-shrink-0">—</span>
              <span className="text-amber-800 dark:text-amber-200 truncate" title={proposedMessage}>
                {proposedMessage}
              </span>
            </>
          )}
          <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">
            ({formatRelativeTime(proposedAt)})
          </span>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setPreviewOpen(true)}
            disabled={isProcessing}
            className="px-2 py-0.5 rounded text-xs font-medium bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            Preview Diff
          </button>
          <button
            onClick={handleAccept}
            disabled={isProcessing}
            className="px-2 py-0.5 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Working…' : 'Accept'}
          </button>
          <button
            onClick={handleReject}
            disabled={isProcessing}
            className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject
          </button>
        </div>
      </div>

      {/* Preview diff modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
          onClick={() => setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Preview proposed edit"
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-5xl w-full mx-4 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Proposed edit
                {proposedMessage && (
                  <span className="ml-2 font-normal text-gray-600 dark:text-gray-400">
                    — {proposedMessage}
                  </span>
                )}
              </h3>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-gray-900">
              {!hasChanges ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
                  No changes detected
                </div>
              ) : (
                <DiffViewer
                  oldValue={currentCode}
                  newValue={proposedCode}
                  splitView={true}
                  useDarkTheme={isDark}
                  leftTitle="Current"
                  rightTitle="Proposed"
                  hideLineNumbers={false}
                  showDiffOnly={true}
                />
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setPreviewOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={async () => {
                  setPreviewOpen(false);
                  await handleAccept();
                }}
                disabled={isProcessing || !hasChanges}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isProcessing || !hasChanges
                    ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

ProposedEditReview.displayName = 'ProposedEditReview';

export default ProposedEditReview;
