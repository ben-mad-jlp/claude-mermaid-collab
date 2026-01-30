import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { AIUIRenderer } from '../ai-ui/renderer';
import { MessageArea } from './MessageArea';
import { InputControls } from './InputControls';
import { SplitPane } from '../layout/SplitPane';
import { TerminalTabsContainer } from '../terminal/TerminalTabsContainer';

export interface ChatPanelProps {
  className?: string;
  onAutoSwitch?: () => void;
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
export const ChatPanel: React.FC<ChatPanelProps> = ({ className, onAutoSwitch }) => {
  const { messages, respondToMessage, clearMessages } = useChatStore();
  const { chatPanelVisible: showChat, terminalPanelVisible: showTerminal } = useUIStore();
  const currentSession = useSessionStore(state => state.currentSession);

  // Auto-scroll to top when new messages arrive (since newest is at top)
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = 0;
    }
  }, [messages]);

  // Handle action from rendered components - needs message ID to respond
  const createActionHandler = (messageId: string) => async (actionId: string, payload?: any) => {
    await respondToMessage(messageId, { action: actionId, ...payload });
  };

  // Find the newest blocking message that hasn't been responded to or canceled
  const pendingBlockingMessage = messages.find(m => m.blocking && !m.responded && !m.canceled);

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

  // Chat panel content
  const chatContent = !currentSession ? (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center text-center px-4">
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Select a session to view messages
        </p>
      </div>
    </div>
  ) : (
    <div className="flex flex-col h-full">
      {/* Chat Input - at top */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <InputControls
          onSend={handleSendMessage}
          onClear={handleClearMessages}
          disabled={!pendingBlockingMessage}
          clearDisabled={messages.length === 0}
        />
      </div>

      {/* Messages Container - newest first */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
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
          <MessageArea messages={messages} onAction={createActionHandler} />
        )}
      </div>
    </div>
  );

  // Terminal panel content
  const terminalContent = <TerminalTabsContainer className="h-full" />;

  // Render content based on visibility
  const renderContent = () => {
    if (showChat && showTerminal) {
      // Both visible - use SplitPane
      return (
        <SplitPane
          direction="horizontal"
          defaultPrimarySize={50}
          minPrimarySize={25}
          minSecondarySize={25}
          storageId="chat-terminal-split"
          primaryContent={chatContent}
          secondaryContent={terminalContent}
        />
      );
    } else if (showChat) {
      // Only chat visible
      return chatContent;
    } else if (showTerminal) {
      // Only terminal visible
      return terminalContent;
    } else {
      // Neither visible - show placeholder
      return (
        <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
          <p className="text-sm">Use the Chat or Terminal buttons in the header to show panels</p>
        </div>
      );
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
      {renderContent()}
    </div>
  );
};

ChatPanel.displayName = 'ChatPanel';
