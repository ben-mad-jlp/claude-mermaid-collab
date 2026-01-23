import React from 'react';

export interface ChatToggleProps {
  onClick: () => void;
  unreadCount: number;
  isOpen: boolean;
}

/**
 * ChatToggle Component
 *
 * A button component that toggles the chat drawer visibility.
 * Shows an unread message badge when there are unread messages.
 *
 * Features:
 * - Fixed position in top-left corner
 * - Badge displays unread count (red circle)
 * - Icon changes based on drawer state
 * - Hamburger/chat icon for visual feedback
 *
 * @param onClick - Handler for toggle click event
 * @param unreadCount - Number of unread messages
 * @param isOpen - Whether drawer is currently open
 */
export const ChatToggle: React.FC<ChatToggleProps> = ({
  onClick,
  unreadCount,
  isOpen,
}) => {
  return (
    <div className="fixed top-4 left-4 z-40">
      <button
        onClick={onClick}
        className={`
          relative
          w-10 h-10
          rounded-lg
          flex items-center justify-center
          transition-all duration-200
          ${
            isOpen
              ? 'bg-blue-600 text-white shadow-lg'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
          }
        `}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        title={unreadCount > 0 ? `${unreadCount} unread messages` : 'Chat'}
      >
        {/* Hamburger/Chat Icon */}
        {isOpen ? (
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        ) : (
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
        )}

        {/* Badge - Show when there are unread messages */}
        {unreadCount > 0 && (
          <div className="absolute top-0 right-0 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center transform translate-x-1/3 -translate-y-1/3">
            <span className="text-white text-xs font-bold">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </div>
        )}
      </button>
    </div>
  );
};
