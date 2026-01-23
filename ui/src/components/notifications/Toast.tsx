/**
 * Toast Component
 *
 * Displays a single notification with:
 * - Icon based on notification type (info/success/warning/error)
 * - Title and optional message
 * - Dismiss button
 * - Enter/exit animations
 *
 * Auto-dismisses after a specified duration (0 = persistent).
 */

import React, { useEffect } from 'react';
import type { Toast as ToastType } from '@/stores/notificationStore';

export interface ToastProps {
  /** Toast data containing type, title, message, and id */
  toast: ToastType;
  /** Callback when toast is dismissed */
  onDismiss: (id: string) => void;
}

/**
 * Icon components for different toast types
 */
const InfoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
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

const SuccessIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
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

const WarningIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
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

const ErrorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
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

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
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
);

/**
 * Toast component - displays a single notification
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  // Determine styling based on toast type
  const getTypeStyles = () => {
    switch (toast.type) {
      case 'success':
        return {
          container: 'bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500',
          icon: 'text-green-500',
          title: 'text-green-900 dark:text-green-100',
          message: 'text-green-700 dark:text-green-200',
        };
      case 'warning':
        return {
          container: 'bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500',
          icon: 'text-amber-500',
          title: 'text-amber-900 dark:text-amber-100',
          message: 'text-amber-700 dark:text-amber-200',
        };
      case 'error':
        return {
          container: 'bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500',
          icon: 'text-red-500',
          title: 'text-red-900 dark:text-red-100',
          message: 'text-red-700 dark:text-red-200',
        };
      case 'info':
      default:
        return {
          container: 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500',
          icon: 'text-blue-500',
          title: 'text-blue-900 dark:text-blue-100',
          message: 'text-blue-700 dark:text-blue-200',
        };
    }
  };

  const styles = getTypeStyles();

  // Get appropriate icon component based on type
  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <SuccessIcon className={`w-5 h-5 ${styles.icon}`} />;
      case 'warning':
        return <WarningIcon className={`w-5 h-5 ${styles.icon}`} />;
      case 'error':
        return <ErrorIcon className={`w-5 h-5 ${styles.icon}`} />;
      case 'info':
      default:
        return <InfoIcon className={`w-5 h-5 ${styles.icon}`} />;
    }
  };

  const handleDismiss = () => {
    onDismiss(toast.id);
  };

  return (
    <div
      data-testid={`toast-${toast.id}`}
      className={`
        flex items-start gap-3
        px-4 py-3
        rounded-lg
        shadow-lg
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        animate-slideInRight
      `}
      role="alert"
      aria-live="polite"
    >
      {/* Icon - left side */}
      <div className="flex-shrink-0 pt-0.5">{getIcon()}</div>

      {/* Content - middle */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${styles.title}`}>{toast.title}</p>
        {toast.message && (
          <p className={`text-sm mt-1 ${styles.message}`}>{toast.message}</p>
        )}
      </div>

      {/* Dismiss button - right side */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className={`
          flex-shrink-0
          p-1
          rounded-md
          text-gray-400 dark:text-gray-500
          hover:text-gray-600 dark:hover:text-gray-300
          hover:bg-gray-100 dark:hover:bg-gray-700
          transition-colors
        `}
      >
        <CloseIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

export default Toast;
