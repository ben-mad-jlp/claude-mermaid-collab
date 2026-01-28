import React from 'react';
import { ChatPanel } from '../chat-drawer/ChatPanel';

export interface ChatMessage {
  id: string;
  type: 'text' | 'ai-ui';
  content: string;
  timestamp: Date;
}

export interface ChatTabProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onAutoSwitch: () => void;
}

/**
 * ChatTab Component
 *
 * Full-screen chat wrapper that:
 * - Wraps the existing ChatPanel component in a full-screen container
 * - Renders AI UI cards inline within the chat message flow (not as overlay)
 * - Provides callback for auto-switching to Chat tab when AI UI arrives
 * - Fills available height between header and tab bar on mobile
 */
export const ChatTab: React.FC<ChatTabProps> = ({
  messages,
  onSendMessage,
  onAutoSwitch,
}) => {
  return (
    <div
      data-testid="chat-tab-wrapper"
      className="h-full flex-1 flex flex-col bg-white dark:bg-gray-900"
    >
      <ChatPanel
        onAutoSwitch={onAutoSwitch}
      />
    </div>
  );
};

ChatTab.displayName = 'ChatTab';
