import React from 'react';

export interface ResumedBannerProps {
  sessionId: string;
  previousTurnCount?: number;
  onDismiss?: () => void;
}

/**
 * Banner displayed when an agent session has been resumed from a prior state.
 * Shows a truncated session id and the number of prior turns, with an optional
 * dismiss button. Uses a muted accent color.
 */
export const ResumedBanner: React.FC<ResumedBannerProps> = ({
  sessionId,
  previousTurnCount,
  onDismiss,
}) => {
  const shortId = sessionId.slice(0, 8);
  const turns = previousTurnCount ?? 0;

  return (
    <div
      role="status"
      className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400"
    >
      <span className="truncate">
        Resumed session {shortId} · {turns} prior turns
      </span>
      <div className="flex-1" />
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="px-1.5 py-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default ResumedBanner;
