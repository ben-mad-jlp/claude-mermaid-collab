/**
 * StatusIndicator Component
 *
 * Displays agent status with visual indicators:
 * - Working: Spinner (blue)
 * - Waiting: Alert icon (yellow)
 * - Idle: Check icon (gray)
 *
 * Supports custom messages and dark mode.
 */

import React from 'react';

export interface StatusIndicatorProps {
  /** Current agent status */
  status: 'working' | 'waiting' | 'idle';
  /** Optional custom message (overrides default) */
  message?: string;
  /** Optional custom className */
  className?: string;
}

/**
 * Status indicator showing agent state
 *
 * @example
 * ```tsx
 * <StatusIndicator status="working" message="Processing..." />
 * <StatusIndicator status="waiting" />
 * <StatusIndicator status="idle" className="custom-class" />
 * ```
 */
export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  message,
  className = '',
}) => {
  // Default messages for each status
  const defaultMessages = {
    working: 'Processing',
    waiting: 'Waiting for input',
    idle: 'Ready',
  };

  const displayMessage = message || defaultMessages[status];

  // Status-specific styling
  const statusStyles = {
    working: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-200 dark:border-blue-800',
    },
    waiting: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      text: 'text-yellow-700 dark:text-yellow-300',
      border: 'border-yellow-200 dark:border-yellow-800',
    },
    idle: {
      bg: 'bg-gray-50 dark:bg-gray-900/20',
      text: 'text-gray-700 dark:text-gray-300',
      border: 'border-gray-200 dark:border-gray-800',
    },
  };

  const styles = statusStyles[status];

  // ARIA label
  const ariaLabel = `Agent status: ${status}, ${displayMessage}`;

  return (
    <div
      data-testid="status-indicator"
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      aria-atomic="true"
      className={`
        flex items-center gap-2
        px-3 py-1.5
        rounded-lg
        border
        transition-all duration-200
        ${styles.bg}
        ${styles.text}
        ${styles.border}
        ${className}
      `.trim()}
    >
      {status === 'working' ? (
        <>
          {/* Spinner for working status */}
          <div data-testid="status-spinner" className="flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          </div>
        </>
      ) : (
        <>
          {/* Icon for waiting/idle status */}
          {status === 'waiting' ? (
            <svg
              data-testid="status-icon"
              className="w-4 h-4 flex-shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              {/* Warning/alert icon */}
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              data-testid="status-icon"
              className="w-4 h-4 flex-shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              {/* Check icon */}
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </>
      )}

      {/* Status text */}
      <span className="text-sm font-medium whitespace-nowrap">{displayMessage}</span>
    </div>
  );
};

export default StatusIndicator;
