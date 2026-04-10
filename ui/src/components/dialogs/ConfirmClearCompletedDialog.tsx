import React, { useEffect, useRef } from 'react';

interface ConfirmClearCompletedDialogProps {
  isOpen: boolean;
  completedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmClearCompletedDialog: React.FC<ConfirmClearCompletedDialogProps> = ({
  isOpen,
  completedCount,
  onConfirm,
  onCancel,
}) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      confirmButtonRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      onConfirm();
    }
  };

  const label = completedCount === 1 ? 'completed todo' : 'completed todos';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-clear-completed-title"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="confirm-clear-completed-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            Clear Completed Todos
          </h2>
        </div>
        <div className="p-6">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Delete {completedCount} {label}? This cannot be undone.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-red-600 text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 outline-none"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmClearCompletedDialog;
