/**
 * Alert Component
 *
 * Status messages, warnings, errors, or informational content.
 * Used for displaying alerts with different severity levels.
 *
 * Features:
 * - Multiple alert types (success, warning, error, info)
 * - Optional title and message
 * - Dismissible alerts
 * - Optional action buttons
 * - Persistent display option
 * - Color-coded styling
 * - Dark mode support
 */

import React, { useState } from 'react';
import type { AlertProps } from '@/types/ai-ui';

export interface AlertComponentProps extends AlertProps {
  onDismiss?: () => void;
}

/**
 * Get styling classes based on alert type
 */
function getAlertStyles(alertType: string) {
  const styles = {
    success: {
      container: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
      icon: 'text-green-600 dark:text-green-400',
      title: 'text-green-900 dark:text-green-100',
      message: 'text-green-700 dark:text-green-200',
      button: 'text-green-700 dark:text-green-200 hover:text-green-900 dark:hover:text-green-100',
    },
    warning: {
      container:
        'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
      icon: 'text-yellow-600 dark:text-yellow-400',
      title: 'text-yellow-900 dark:text-yellow-100',
      message: 'text-yellow-700 dark:text-yellow-200',
      button:
        'text-yellow-700 dark:text-yellow-200 hover:text-yellow-900 dark:hover:text-yellow-100',
    },
    error: {
      container: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
      icon: 'text-red-600 dark:text-red-400',
      title: 'text-red-900 dark:text-red-100',
      message: 'text-red-700 dark:text-red-200',
      button: 'text-red-700 dark:text-red-200 hover:text-red-900 dark:hover:text-red-100',
    },
    info: {
      container: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
      icon: 'text-blue-600 dark:text-blue-400',
      title: 'text-blue-900 dark:text-blue-100',
      message: 'text-blue-700 dark:text-blue-200',
      button: 'text-blue-700 dark:text-blue-200 hover:text-blue-900 dark:hover:text-blue-100',
    },
  };

  return (
    styles[alertType as keyof typeof styles] || styles.info
  );
}

/**
 * Get icon SVG based on alert type
 */
function getAlertIcon(alertType: string): React.ReactNode {
  switch (alertType) {
    case 'success':
      return (
        <svg
          className="w-5 h-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'warning':
      return (
        <svg
          className="w-5 h-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'error':
      return (
        <svg
          className="w-5 h-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'info':
    default:
      return (
        <svg
          className="w-5 h-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      );
  }
}

/**
 * Alert component - Status messages with configurable type and styling
 */
export const Alert: React.FC<AlertComponentProps> = ({
  type = 'info',
  title,
  message,
  dismissible = false,
  icon,
  actions = [],
  persistent = false,
  className = '',
  hidden = false,
  onDismiss,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (hidden || (isDismissed && !persistent)) {
    return null;
  }

  const styles = getAlertStyles(type);
  const displayIcon = icon || getAlertIcon(type);

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      className={`
        flex items-start gap-4
        px-4 py-3
        rounded-lg
        border
        ${styles.container}
        ${className}
      `}
      role="alert"
    >
      {/* Icon */}
      <div className={`flex-shrink-0 ${styles.icon}`}>{displayIcon}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {title && (
          <h3 className={`font-semibold ${styles.title}`}>
            {title}
          </h3>
        )}
        {message && (
          <p className={`text-sm ${styles.message} ${title ? 'mt-1' : ''}`}>
            {message}
          </p>
        )}

        {/* Actions */}
        {actions && actions.length > 0 && (
          <div className="flex gap-2 mt-3">
            {actions.map((action) => (
              <button
                key={action.id}
                className={`
                  text-sm font-medium
                  px-3 py-2
                  rounded
                  hover:bg-white/20
                  transition-colors
                  ${styles.button}
                `}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dismiss Button */}
      {dismissible && (
        <button
          onClick={handleDismiss}
          className={`
            flex-shrink-0
            p-2
            rounded-lg
            hover:bg-white/20
            transition-colors
            ${styles.button}
          `}
          aria-label="Dismiss alert"
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
  );
};

export default Alert;
