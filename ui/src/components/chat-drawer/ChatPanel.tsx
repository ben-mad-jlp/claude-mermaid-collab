import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { AIUIRenderer } from '../ai-ui/renderer';

export interface ChatPanelProps {
  className?: string;
}

/**
 * ChatPanel Component
 *
 * Always-visible panel displaying chat messages and AI UI components.
 * Designed to be used within a SplitPane layout.
 *
 * Changes from ChatDrawer:
 * - Removed fixed positioning
 * - Removed overlay behavior
 * - Removed slide animation
 * - Removed isOpen/onClose props
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
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
    <div
      className={`
        flex flex-col h-full
        bg-white dark:bg-gray-900
        border-l border-gray-200 dark:border-gray-800
        ${className || ''}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Claude
        </h2>
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
  );
};

ChatPanel.displayName = 'ChatPanel';
