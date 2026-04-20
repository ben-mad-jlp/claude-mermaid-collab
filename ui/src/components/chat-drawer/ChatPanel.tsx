import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { ChatHost } from '../chat-host/ChatHost';
import { MigrationBannerV5 } from '../layout/MigrationBannerV5';

export interface ChatPanelProps {
  className?: string;
  onAutoSwitch?: () => void;
}

/**
 * ChatPanel — right-side panel rendering the ChatHost full-height.
 */
export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
  const currentSession = useSessionStore(state => state.currentSession);

  return (
    <div
      className={`
        flex flex-col h-full
        bg-white dark:bg-gray-900
        border-l border-gray-200 dark:border-gray-800
        ${className || ''}
      `}
    >
      <MigrationBannerV5 />
      {!currentSession ? (
        <div className="flex flex-col h-full">
          <div className="flex-1 flex items-center justify-center text-center px-4">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Select a session to view messages
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 h-full">
          <ChatHost sessionId={currentSession?.name ?? ''} />
        </div>
      )}
    </div>
  );
};

ChatPanel.displayName = 'ChatPanel';
