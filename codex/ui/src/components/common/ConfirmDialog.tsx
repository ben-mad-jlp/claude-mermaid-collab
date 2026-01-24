/**
 * ConfirmDialog Component
 *
 * Modal dialog for confirmations with optional reason input.
 */

import React, { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Dialog title */
  title: string;
  /** Dialog message */
  message: string;
  /** Confirm button label */
  confirmLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Confirm button click handler */
  onConfirm: () => void;
  /** Cancel button click handler */
  onCancel: () => void;
  /** Show optional reason textarea */
  showReasonInput?: boolean;
  /** Current reason value */
  reasonValue?: string;
  /** Reason change handler */
  onReasonChange?: (reason: string) => void;
}

/**
 * ConfirmDialog component - Modal for confirmations
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  showReasonInput = false,
  reasonValue = '',
  onReasonChange,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management when dialog opens
  useEffect(() => {
    if (open && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [open]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  // Handle click outside
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  if (!open) return null;

  return (
    <div
      className="
        fixed inset-0 z-50
        flex items-center justify-center
        bg-black/50
        backdrop-blur-sm
      "
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      <div
        ref={dialogRef}
        className="
          w-full max-w-md mx-4
          bg-white dark:bg-gray-800
          rounded-lg shadow-xl
          transform transition-all
        "
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {title}
          </h2>
          <p
            id="confirm-dialog-message"
            className="mt-2 text-sm text-gray-600 dark:text-gray-300"
          >
            {message}
          </p>
        </div>

        {/* Reason Input */}
        {showReasonInput && (
          <div className="px-6 pb-4">
            <label
              htmlFor="reason-input"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Reason (optional)
            </label>
            <textarea
              id="reason-input"
              value={reasonValue}
              onChange={(e) => onReasonChange?.(e.target.value)}
              placeholder="Enter reason..."
              rows={3}
              className="
                w-full px-3 py-2
                text-sm
                text-gray-900 dark:text-white
                bg-gray-50 dark:bg-gray-700
                border border-gray-300 dark:border-gray-600
                rounded-md
                focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
                resize-none
              "
            />
          </div>
        )}

        {/* Actions */}
        <div
          className="
            px-6 py-4
            bg-gray-50 dark:bg-gray-700/50
            rounded-b-lg
            flex justify-end gap-3
          "
        >
          <button
            type="button"
            onClick={onCancel}
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
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="
              px-4 py-2
              text-sm font-medium
              text-white
              bg-accent-600 hover:bg-accent-700
              dark:bg-accent-500 dark:hover:bg-accent-600
              rounded-md
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500
              transition-colors
            "
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
