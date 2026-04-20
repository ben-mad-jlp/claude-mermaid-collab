import React from 'react';

export interface ErrorRecoveryBannerProps {
  error: string;
  onRetry?: () => void;
  onResume?: () => void;
  onDismiss?: () => void;
}

/**
 * Banner displayed after an unexpected child-exit, offering retry/resume
 * affordances. Renders in a red alert style with the error text and up to
 * three action buttons.
 */
export const ErrorRecoveryBanner: React.FC<ErrorRecoveryBannerProps> = ({
  error,
  onRetry,
  onResume,
  onDismiss,
}) => {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 px-3 py-1.5 border-b border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/40 text-xs text-red-700 dark:text-red-200"
    >
      <span className="truncate flex-1">{error}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-2 py-0.5 rounded border border-red-300 dark:border-red-700 text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
        >
          Retry
        </button>
      )}
      {onResume && (
        <button
          type="button"
          onClick={onResume}
          className="px-2 py-0.5 rounded border border-red-300 dark:border-red-700 text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
        >
          Resume
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="px-1.5 py-0.5 text-red-500 dark:text-red-300 hover:text-red-700 dark:hover:text-red-100 transition-colors"
        >
          Dismiss
        </button>
      )}
    </div>
  );
};

export default ErrorRecoveryBanner;
