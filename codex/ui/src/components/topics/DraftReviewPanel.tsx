/**
 * DraftReviewPanel Component
 *
 * Draft approval panel with view mode toggle, document tabs,
 * and approve/reject actions.
 */

import React, { useState, useCallback } from 'react';
import type { DraftInfo, DocumentType, DraftViewMode } from '../../types';
import { DocumentTabs } from './DocumentTabs';
import { DocumentViewer } from './DocumentViewer';
import { DraftDiffViewer } from './DraftDiffViewer';
import { NameInput } from '../common/NameInput';
import { useDraft } from '../../hooks/useDrafts';

export interface DraftReviewPanelProps {
  /** Topic name */
  topicName: string;
  /** Draft information */
  draft: DraftInfo;
  /** Callback when draft is approved */
  onApprove: (approvedBy: string) => Promise<void>;
  /** Callback when draft is rejected */
  onReject: (rejectedBy: string, reason?: string) => Promise<void>;
  /** Callback when panel should close */
  onClose?: () => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * View mode button component
 */
interface ViewModeButtonProps {
  mode: DraftViewMode;
  currentMode: DraftViewMode;
  onClick: (mode: DraftViewMode) => void;
  children: React.ReactNode;
}

const ViewModeButton: React.FC<ViewModeButtonProps> = ({
  mode,
  currentMode,
  onClick,
  children,
}) => {
  const isActive = mode === currentMode;

  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={`
        px-3 py-1.5
        text-sm font-medium
        rounded-md
        transition-colors
        focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
        ${
          isActive
            ? 'bg-accent-600 dark:bg-accent-500 text-white'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
        }
      `}
    >
      {children}
    </button>
  );
};

/**
 * Format trigger type for display
 */
function formatTriggerType(triggerType: DraftInfo['triggerType']): string {
  switch (triggerType) {
    case 'flag_response':
      return 'Flag Response';
    case 'missing_topic':
      return 'Missing Topic';
    case 'scheduled_refresh':
      return 'Scheduled Refresh';
    case 'source_change':
      return 'Source Change';
    case 'manual':
      return 'Manual';
    default:
      return triggerType;
  }
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * DraftReviewPanel component - Draft approval panel
 */
export const DraftReviewPanel: React.FC<DraftReviewPanelProps> = ({
  topicName,
  draft,
  onApprove,
  onReject,
  onClose,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<DraftViewMode>('diff');
  const [activeTab, setActiveTab] = useState<DocumentType>('conceptual');
  const [approvedBy, setApprovedBy] = useState('');
  const [rejectedBy, setRejectedBy] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Get diff data from hook
  const { diff } = useDraft(topicName);

  // Get current document diff based on active tab
  const currentDiff = diff?.find((d) => d.documentType === activeTab);

  // Get content based on view mode
  const getContent = useCallback(() => {
    if (!currentDiff) {
      return {
        current: '',
        draft: draft.documents[activeTab] || '',
      };
    }
    return {
      current: currentDiff.current,
      draft: currentDiff.draft,
    };
  }, [currentDiff, draft.documents, activeTab]);

  // Handle approve action
  const handleApprove = async () => {
    if (!approvedBy.trim()) {
      alert('Please enter your name');
      return;
    }

    setIsApproving(true);
    try {
      await onApprove(approvedBy.trim());
    } finally {
      setIsApproving(false);
    }
  };

  // Handle reject action
  const handleReject = async () => {
    if (!rejectedBy.trim()) {
      alert('Please enter your name');
      return;
    }

    setIsRejecting(true);
    try {
      await onReject(rejectedBy.trim(), rejectReason.trim() || undefined);
    } finally {
      setIsRejecting(false);
    }
  };

  const content = getContent();

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Review Draft: {draft.topicName}
            </h2>
            <span
              className="
                inline-flex items-center
                px-2.5 py-0.5
                text-xs font-medium
                rounded-full
                bg-blue-100 text-blue-800
                dark:bg-blue-900/50 dark:text-blue-200
              "
            >
              {formatTriggerType(draft.triggerType)}
            </span>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="
                p-1.5
                text-gray-500 dark:text-gray-400
                hover:text-gray-700 dark:hover:text-gray-300
                hover:bg-gray-100 dark:hover:bg-gray-700
                rounded-md
                focus:outline-none focus:ring-2 focus:ring-accent-500
                transition-colors
              "
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clipRule="evenodd"
              />
            </svg>
            <span>Generated: {formatDate(draft.generatedAt)}</span>
          </div>
          {currentDiff && (
            <div className="flex items-center gap-3">
              <span className="text-green-600 dark:text-green-400">
                +{currentDiff.additions}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{currentDiff.deletions}
              </span>
            </div>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">
            View:
          </span>
          <ViewModeButton
            mode="current"
            currentMode={viewMode}
            onClick={setViewMode}
          >
            Current
          </ViewModeButton>
          <ViewModeButton
            mode="draft"
            currentMode={viewMode}
            onClick={setViewMode}
          >
            Draft
          </ViewModeButton>
          <ViewModeButton
            mode="diff"
            currentMode={viewMode}
            onClick={setViewMode}
          >
            Diff
          </ViewModeButton>
        </div>
      </div>

      {/* Document tabs */}
      <DocumentTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="flex-shrink-0 bg-white dark:bg-gray-800"
      />

      {/* Content viewer */}
      <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900 p-4">
        {viewMode === 'diff' ? (
          <DraftDiffViewer
            current={content.current}
            draft={content.draft}
            className="h-full"
          />
        ) : (
          <DocumentViewer
            content={viewMode === 'current' ? content.current : content.draft}
            className="h-full"
          />
        )}
      </div>

      {/* Action footer */}
      <div className="flex-shrink-0 px-6 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        {showRejectForm ? (
          /* Reject form */
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <NameInput
                value={rejectedBy}
                onChange={setRejectedBy}
                label="Rejected by"
                placeholder="Your name"
                required
                className="w-48"
              />
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why is this draft being rejected?"
                  className="
                    w-full
                    px-3 py-2
                    text-sm
                    bg-white dark:bg-gray-700
                    border border-gray-300 dark:border-gray-600
                    rounded-md
                    text-gray-900 dark:text-white
                    placeholder-gray-400 dark:placeholder-gray-500
                    focus:outline-none focus:ring-2 focus:ring-red-500
                    focus:border-transparent
                  "
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowRejectForm(false)}
                className="
                  px-4 py-2
                  text-sm font-medium
                  text-gray-700 dark:text-gray-300
                  bg-white dark:bg-gray-700
                  border border-gray-300 dark:border-gray-600
                  rounded-md
                  hover:bg-gray-50 dark:hover:bg-gray-600
                  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500
                  transition-colors
                "
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={isRejecting || !rejectedBy.trim()}
                className="
                  inline-flex items-center gap-2
                  px-4 py-2
                  text-sm font-medium
                  text-white
                  bg-red-600 hover:bg-red-700
                  dark:bg-red-500 dark:hover:bg-red-600
                  rounded-md
                  disabled:opacity-50 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
                  transition-colors
                "
              >
                {isRejecting ? (
                  <>
                    <svg
                      className="animate-spin w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Rejecting...
                  </>
                ) : (
                  'Confirm Reject'
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Approve/Reject buttons */
          <div className="flex items-center gap-4">
            <NameInput
              value={approvedBy}
              onChange={setApprovedBy}
              label="Approved by"
              placeholder="Your name"
              required
              className="w-48"
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setShowRejectForm(true)}
              className="
                inline-flex items-center gap-2
                px-4 py-2
                text-sm font-medium
                text-red-700 dark:text-red-400
                bg-white dark:bg-gray-700
                border border-red-300 dark:border-red-600
                rounded-md
                hover:bg-red-50 dark:hover:bg-red-900/20
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Reject
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={isApproving || !approvedBy.trim()}
              className="
                inline-flex items-center gap-2
                px-4 py-2
                text-sm font-medium
                text-white
                bg-green-600 hover:bg-green-700
                dark:bg-green-500 dark:hover:bg-green-600
                rounded-md
                disabled:opacity-50 disabled:cursor-not-allowed
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500
                transition-colors
              "
            >
              {isApproving ? (
                <>
                  <svg
                    className="animate-spin w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Approving...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Approve
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftReviewPanel;
