/**
 * ToastContainer Component
 *
 * Manages and displays all active toasts in a fixed container.
 * Features:
 * - Fixed positioning at bottom-right
 * - Stacks toasts vertically (newest at bottom)
 * - Limits display to 5 visible toasts
 * - Auto-dismisses toasts based on their duration
 * - Handles manual dismissal via Toast component
 */

import React, { useEffect } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';
import { Toast } from './Toast';

/**
 * ToastContainer component - renders all active toasts
 */
export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useNotificationStore();

  // Limit to 5 visible toasts, showing the most recent ones
  const visibleToasts = toasts.slice(-5);

  return (
    <div
      className={`
        fixed
        bottom-4
        right-4
        flex
        flex-col-reverse
        gap-2
        pointer-events-none
        z-[9999]
      `}
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {visibleToasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto"
        >
          <Toast
            toast={toast}
            onDismiss={removeToast}
          />
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
