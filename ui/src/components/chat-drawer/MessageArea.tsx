/**
 * MessageArea Component
 *
 * Renders chat messages including artifact notifications
 * Integrates ArtifactLink for artifact navigation
 */

import React from 'react';
import { AIUIRenderer } from '../ai-ui/renderer';
import { ArtifactLink } from '../ArtifactLink';
import { useViewerStore } from '@/stores/viewerStore';
import type { ChatMessage } from '@/stores/chatStore';

export interface MessageAreaProps {
  messages: ChatMessage[];
  onAction: (messageId: string) => (actionId: string, payload?: any) => void;
}

/**
 * Check if a message contains artifact notification data
 */
function hasArtifactData(message: ChatMessage): boolean {
  if (message.type !== 'notification') return false;
  // Check if response contains artifact data
  if (message.response?.artifactType && message.response?.id && message.response?.name) {
    return true;
  }
  return false;
}

/**
 * Extract artifact data from message
 */
function getArtifactData(message: ChatMessage) {
  if (!message.response) return null;
  return {
    type: message.response.type || 'created',
    artifactType: message.response.artifactType,
    id: message.response.id,
    name: message.response.name,
  };
}

export const MessageArea: React.FC<MessageAreaProps> = ({ messages, onAction }) => {
  const { navigateToArtifact } = useViewerStore();

  const handleArtifactClick = (id: string, type: 'document' | 'diagram') => {
    navigateToArtifact(id, type);
  };

  return (
    <>
      {messages.map((message, index) => {
        const hasArtifact = hasArtifactData(message);
        const artifactData = hasArtifact ? getArtifactData(message) : null;

        return (
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

            {/* Render content based on message type */}
            {message.type === 'ui_render' && message.ui ? (
              <AIUIRenderer
                component={message.ui}
                onAction={onAction(message.id)}
                disabled={message.responded}
              />
            ) : hasArtifact && artifactData ? (
              <ArtifactLink
                notification={artifactData}
                onClick={handleArtifactClick}
              />
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {message.response?.message || 'No content'}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
};

MessageArea.displayName = 'MessageArea';
