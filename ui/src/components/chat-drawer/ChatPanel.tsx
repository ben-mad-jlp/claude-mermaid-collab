import React, { useEffect, useRef, useState } from 'react';
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
  const { messages, respondToMessage, clearMessages } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle action from rendered components - needs message ID to respond
  const createActionHandler = (messageId: string) => async (actionId: string, payload?: any) => {
    await respondToMessage(messageId, { action: actionId, ...payload });
  };

  // Find the last blocking message that hasn't been responded to
  const pendingBlockingMessage = messages.filter(m => m.blocking && !m.responded).pop();

  // Handle sending a custom text response
  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    if (pendingBlockingMessage) {
      // Respond to the pending blocking message with custom text
      respondToMessage(pendingBlockingMessage.id, {
        action: 'custom_response',
        data: { text: inputValue.trim() }
      });
    }
    setInputValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // Reset height to auto to get the correct scrollHeight
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
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
      <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Chat
        </h2>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            Clear
          </button>
        )}
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
                Messages will appear here
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div
                key={message.id}
                data-testid={`message-${message.id}`}
                data-blocking={message.blocking}
                data-responded={message.responded}
                className={index > 0 ? 'pt-4 border-t border-gray-200 dark:border-gray-700' : ''}
              >
                {/* Header with timestamp and badges */}
                <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                  {message.blocking && (
                    <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded font-medium">
                      Blocking
                    </span>
                  )}
                  {message.responded && (
                    <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded font-medium">
                      Responded
                    </span>
                  )}
                </div>

                {/* Render UI Component */}
                {message.type === 'ui_render' && message.ui ? (
                  <AIUIRenderer
                    component={message.ui}
                    onAction={createActionHandler(message.id)}
                    disabled={message.responded}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {message.response?.message || 'No content'}
                  </p>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Chat Input */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={pendingBlockingMessage ? "Type a response..." : "No pending message"}
            disabled={!pendingBlockingMessage}
            rows={1}
            style={{ minHeight: '38px' }}
            className="
              flex-1 px-3 py-2 text-sm
              border border-gray-300 dark:border-gray-600 rounded-lg
              bg-white dark:bg-gray-700
              text-gray-900 dark:text-white
              placeholder-gray-400 dark:placeholder-gray-500
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              disabled:opacity-50 disabled:cursor-not-allowed
              resize-none overflow-hidden
            "
          />
          <button
            onClick={handleSendMessage}
            disabled={!pendingBlockingMessage || !inputValue.trim()}
            className="
              px-4 py-2 text-sm font-medium
              bg-blue-600 hover:bg-blue-700 text-white
              rounded-lg transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

ChatPanel.displayName = 'ChatPanel';
