/**
 * MobileLayout Component
 *
 * Root mobile layout container that:
 * - Renders: MobileHeader + active tab content + BottomTabBar
 * - Manages activeTab state: 'preview' | 'chat'
 * - Full viewport height with flex column layout
 * - Keeps all tabs mounted (hidden with display:none) to preserve state
 *
 * Props match desktop layout (sessions, handlers, connection state)
 */

import React, { useState, useCallback } from 'react';
import { MobileHeader } from './MobileHeader';
import { BottomTabBar, MobileTab } from './BottomTabBar';
import { WorktreeBadge } from './WorktreeBadge';
import { MobilePreviewTab } from '../mobile/MobilePreviewTab';
import { ChatTab } from '../mobile/ChatTab';
import { useSessionStore } from '../../stores/sessionStore';
import type { Session } from '@/types';

export interface MobileLayoutHandlers {
  /** Callback when a session is selected */
  onSessionSelect?: (session: Session) => void;
  /** Callback to refresh sessions list */
  onRefreshSessions?: () => void;
  /** Callback to create a new session */
  onCreateSession?: (project: string) => void;
  /** Callback to add a new project */
  onAddProject?: () => void;
  /** Callback to remove a project */
  onRemoveProject?: (project: string) => void;
  /** Callback to delete a session */
  onDeleteSession?: (session: Session) => void;
}

export interface MobileLayoutProps {
  /** Available sessions to select from */
  sessions?: Session[];
  /** Registered projects (may have no sessions yet) */
  registeredProjects?: string[];
  /** Handler callbacks */
  handlers: MobileLayoutHandlers;
  /** WebSocket connection status */
  isConnected?: boolean;
  /** Whether WebSocket is connecting */
  isConnecting?: boolean;
  /** Optional custom class name */
  className?: string;
}

/**
 * MobileLayout component
 *
 * Root container for mobile layout with header, tab content, and bottom navigation.
 * Manages tab switching state and keeps all tabs mounted to preserve their internal state.
 */
export const MobileLayout: React.FC<MobileLayoutProps> = ({
  sessions = [],
  registeredProjects = [],
  handlers,
  isConnected = false,
  isConnecting = false,
  className = '',
}) => {
  // Manage active tab state internally
  const [activeTab, setActiveTab] = useState<MobileTab>('preview');

  // Get current session from store (like desktop does)
  const currentSession = useSessionStore(state => state.currentSession);
  const sessionName = currentSession?.name || '';

  // Handler for tab changes from BottomTabBar
  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
  }, []);

  // Handler for auto-switch to Chat tab (called by ChatTab when AI UI arrives)
  const handleAutoSwitchToChat = useCallback(() => {
    setActiveTab('chat');
  }, []);

  return (
    <div
      className={`h-screen flex flex-col bg-white dark:bg-gray-900 ${className}`}
      style={{ overflow: 'hidden' }}
    >
      {/* Mobile Header */}
      <MobileHeader
        sessions={sessions}
        registeredProjects={registeredProjects}
        onSessionSelect={handlers.onSessionSelect}
        onRefreshSessions={handlers.onRefreshSessions}
        onCreateSession={handlers.onCreateSession}
        onAddProject={handlers.onAddProject}
        onRemoveProject={handlers.onRemoveProject}
        onDeleteSession={handlers.onDeleteSession}
        isConnected={isConnected}
        isConnecting={isConnecting}
      />

      {sessionName && (
        <div className="px-3 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center gap-2">
          <WorktreeBadge sessionId={sessionName} />
        </div>
      )}

      {/* Content Area - Tab Container */}
      <div
        data-testid="mobile-layout-content"
        className="flex-1 overflow-hidden relative"
        style={{ paddingBottom: '4rem' }} /* Account for tab bar height (16 * 0.25 = 4rem) */
      >
        {/* Preview Tab */}
        <div
          data-testid="preview-tab-wrapper"
          className="flex-1 flex flex-col absolute inset-0"
          style={{
            display: activeTab === 'preview' ? 'flex' : 'none',
          }}
        >
          <MobilePreviewTab />
        </div>

        {/* Chat Tab - ChatTab component renders the data-testid */}
        <div
          className="flex-1 flex flex-col absolute inset-0"
          style={{
            display: activeTab === 'chat' ? 'flex' : 'none',
          }}
        >
          <ChatTab
            messages={[]}
            onSendMessage={() => {}}
            onAutoSwitch={handleAutoSwitchToChat}
          />
        </div>
      </div>

      {/* Bottom Tab Bar */}
      <BottomTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
    </div>
  );
};

MobileLayout.displayName = 'MobileLayout';
