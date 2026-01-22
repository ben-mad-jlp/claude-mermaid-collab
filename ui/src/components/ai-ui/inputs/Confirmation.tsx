import React, { useId } from 'react';

export type ConfirmationType = 'yes-no' | 'accept-reject';

export interface ConfirmationProps {
  onConfirm: () => void;
  onCancel: () => void;
  type?: ConfirmationType;
  message?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

export const Confirmation: React.FC<ConfirmationProps> = ({
  onConfirm,
  onCancel,
  type = 'yes-no',
  message,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
}) => {
  const id = useId();
  const messageId = `${id}-message`;

  const confirmLabel = type === 'yes-no' ? 'Yes' : 'Accept';
  const cancelLabel = type === 'yes-no' ? 'No' : 'Reject';

  return (
    <div
      role="group"
      aria-label={ariaLabel || `Confirmation dialog (${type})`}
      aria-describedby={ariaDescribedBy || (message ? messageId : undefined)}
      className="flex flex-col gap-3 w-full"
    >
      {message && (
        <p id={messageId} className="text-sm text-gray-900 dark:text-white">
          {message}
        </p>
      )}
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          disabled={disabled}
          aria-label={cancelLabel}
          className="
            px-4 py-2 text-sm font-medium
            border border-gray-300 rounded-md
            bg-white text-gray-900
            dark:bg-gray-800 dark:text-white dark:border-gray-600
            hover:bg-gray-50 dark:hover:bg-gray-700
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
            dark:focus:ring-offset-gray-900
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
          "
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={disabled}
          aria-label={confirmLabel}
          className="
            px-4 py-2 text-sm font-medium
            border border-transparent rounded-md
            bg-blue-600 text-white
            dark:bg-blue-700
            hover:bg-blue-700 dark:hover:bg-blue-600
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
            dark:focus:ring-offset-gray-900
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
          "
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
};

Confirmation.displayName = 'Confirmation';
