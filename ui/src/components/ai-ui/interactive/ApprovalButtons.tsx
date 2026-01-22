import React, { useState } from 'react';

export interface ApprovalAction {
  id: string;
  label: string;
  primary?: boolean;
  destructive?: boolean;
}

export interface ApprovalButtonsProps {
  actions: ApprovalAction[];
  alignment?: 'left' | 'center' | 'right';
  spacing?: 'compact' | 'normal' | 'spacious';
  fullWidth?: boolean;
  onAction?: (actionId: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * ApprovalButtons Component
 * Action buttons for approval, rejection, or custom actions
 *
 * Features:
 * - Multiple action buttons with different styles
 * - Support for primary and destructive actions
 * - Configurable alignment and spacing
 * - Full-width option
 * - Loading states
 * - Dark mode support
 */
export const ApprovalButtons: React.FC<ApprovalButtonsProps> = ({
  actions,
  alignment = 'center',
  spacing = 'normal',
  fullWidth = false,
  onAction,
  disabled = false,
  className = '',
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleAction = async (actionId: string) => {
    setLoadingAction(actionId);
    try {
      onAction?.(actionId);
    } finally {
      // Reset loading state after a short delay to allow for animations
      setTimeout(() => setLoadingAction(null), 300);
    }
  };

  // Determine alignment class
  const alignmentClass =
    alignment === 'left'
      ? 'justify-start'
      : alignment === 'right'
      ? 'justify-end'
      : 'justify-center';

  // Determine gap class
  const gapClass =
    spacing === 'compact' ? 'gap-2' : spacing === 'spacious' ? 'gap-6' : 'gap-3';

  return (
    <div
      className={`approval-buttons flex flex-wrap ${alignmentClass} ${gapClass} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {actions.map((action) => {
        const isPrimary = action.primary;
        const isDestructive = action.destructive;
        const isLoading = loadingAction === action.id;

        // Determine button styling
        let buttonClass = '';

        if (isPrimary) {
          buttonClass =
            'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white';
        } else if (isDestructive) {
          buttonClass =
            'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white';
        } else {
          buttonClass =
            'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white';
        }

        const disabledClass = disabled || isLoading ? 'opacity-60 cursor-not-allowed' : '';

        return (
          <button
            key={action.id}
            onClick={() => handleAction(action.id)}
            disabled={disabled || isLoading}
            className={`
              px-6 py-2.5 rounded-lg font-medium transition-all duration-200
              ${fullWidth ? 'flex-1 min-w-[120px]' : 'min-w-[120px]'}
              ${buttonClass}
              ${disabledClass}
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
              dark:focus:ring-offset-gray-900
              active:scale-95
            `}
            aria-label={action.label}
            aria-disabled={disabled || isLoading}
          >
            <span
              className={`inline-flex items-center justify-center transition-opacity ${
                isLoading ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {action.label}
            </span>

            {/* Loading Spinner */}
            {isLoading && (
              <span
                className="absolute inline-flex"
                role="status"
                aria-label="Loading"
              >
                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ApprovalButtons;
