import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { AIUIRenderer } from '../ai-ui/renderer';

export interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * ChatDrawer Component
 *
 * A left-side drawer component that displays chat messages and allows
 * users to interact with AI-generated UI components. Features:
 * - Fixed position left drawer (~400px width or responsive)
 * - Auto-scrolling to latest messages
 * - Close button in header
 * - Message list with scroll behavior
 * - Input field for user responses
 * - Smooth slide animation
 * - Support for both blocking and non-blocking messages
 *
 * @param isOpen - Whether the drawer is visible
 * @param onClose - Callback when user closes the drawer
 */
export const ChatDrawer: React.FC<ChatDrawerProps> = ({ isOpen, onClose }) => {
  const { messages, respondToMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle action from rendered components
  const handleAction = async (actionId: string, payload?: any) => {
    await respondToMessage(actionId, payload);
  };

  return (
    <>
      {/* Overlay - Close drawer when clicking outside */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30 lg:hidden"
          onClick={onClose}
          role="presentation"
        />
      )}

      {/* Drawer Container */}
      <div
        className={`
          fixed left-0 top-0 bottom-0
          w-full sm:w-96 lg:w-[400px]
          bg-white dark:bg-gray-900
          border-r border-gray-200 dark:border-gray-800
          shadow-lg
          z-40
          flex flex-col
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Claude
          </h2>
          <button
            onClick={onClose}
            className="
              p-1.5 rounded-lg
              text-gray-600 dark:text-gray-400
              hover:bg-gray-200 dark:hover:bg-gray-700
              transition-colors
            "
            aria-label="Close drawer"
            title="Close (Esc)"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No messages yet
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                  Messages from Claude will appear here
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`
                    p-3 rounded-lg
                    ${
                      message.type === 'ui_render'
                        ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900'
                        : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                    }
                  `}
                  data-testid={`message-${message.id}`}
                  data-blocking={message.blocking}
                  data-responded={message.responded}
                >
                  {/* Message Type Badge */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">
                      {message.type}
                    </span>
                    {message.blocking && (
                      <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded font-medium">
                        Blocking
                      </span>
                    )}
                    {message.responded && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded font-medium">
                        Responded
                      </span>
                    )}
                  </div>

                  {/* Render UI Component */}
                  {message.type === 'ui_render' && message.ui ? (
                    <div className="space-y-3">
                      <AIUIRenderer
                        component={message.ui}
                        onAction={handleAction}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {message.response?.message || 'No content'}
                    </p>
                  )}

                  {/* Timestamp */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Footer Status */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
          {messages.length > 0 ? (
            <p>
              {messages.length} message{messages.length !== 1 ? 's' : ''} •{' '}
              {messages.filter((m) => m.responded).length} responded
            </p>
          ) : (
            <p>Ready to chat</p>
          )}
        </div>
      </div>
    </>
  );
};

ChatDrawer.displayName = 'ChatDrawer';
