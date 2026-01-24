import React, { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { AIUIRenderer } from '../ai-ui/renderer';
import { MessageArea } from './MessageArea';
import { InputControls } from './InputControls';

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
  const handleSendMessage = (message: string) => {
    if (!message.trim()) return;

    if (pendingBlockingMessage) {
      // Respond to the pending blocking message with custom text
      respondToMessage(pendingBlockingMessage.id, {
        action: 'custom_response',
        data: { text: message.trim() }
      });
    }
  };

  const handleClearMessages = () => {
    clearMessages();
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
            <MessageArea messages={messages} onAction={createActionHandler} />
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Chat Input */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <InputControls
          onSend={handleSendMessage}
          onClear={handleClearMessages}
          disabled={!pendingBlockingMessage}
        />
      </div>
    </div>
  );
};

ChatPanel.displayName = 'ChatPanel';
