import React from 'react';

export interface RightPaneCloseButtonProps {
  onClose: () => void;
}

export const RightPaneCloseButton: React.FC<RightPaneCloseButtonProps> = ({
  onClose,
}) => {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close right pane"
      data-testid="right-pane-close-button"
      className="absolute top-2 right-6 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-gray-800/80 hover:bg-red-100 dark:hover:bg-red-900 text-gray-600 dark:text-gray-300 rounded p-1"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
};

export default RightPaneCloseButton;
