/**
 * MobileLayout Component
 *
 * Root mobile layout container that:
 * - Renders: MobileHeader + active tab content + BottomTabBar
 * - Manages activeTab state: 'preview' | 'chat' | 'terminal'
 * - Full viewport height with flex column layout
 * - Keeps all tabs mounted (hidden with display:none) to preserve state
 *
 * Props match desktop layout (sessions, handlers, connection state)
 */

import React, { useState, useCallback } from 'react';
import { MobileHeader } from './MobileHeader';
import { BottomTabBar, MobileTab } from './BottomTabBar';
import { PreviewTab } from '../mobile/PreviewTab';
import { ChatTab } from '../mobile/ChatTab';
import { TerminalTab } from '../mobile/TerminalTab';
import { useSessionStore } from '../../stores/sessionStore';
import { useTerminalTabs } from '../../hooks/useTerminalTabs';
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
  const project = currentSession?.project || '';
  const sessionName = currentSession?.name || '';

  // Use the terminal tabs hook (same as desktop)
  const {
    tabs,
    activeTabId,
    activeTab: activeTerminalTab,
    isLoading,
    error,
    addTab,
    removeTab,
    setActiveTab: setActiveTerminalTab,
  } = useTerminalTabs({ project, session: sessionName });

  // Handler for tab changes from BottomTabBar
  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
  }, []);

  // Handler for auto-switch to Chat tab (called by ChatTab when AI UI arrives)
  const handleAutoSwitchToChat = useCallback(() => {
    setActiveTab('chat');
  }, []);

  // Handler for adding a new terminal tab
  const handleAddTerminal = useCallback(async () => {
    try {
      await addTab();
      // Auto-switch to terminal tab when creating a new terminal
      setActiveTab('terminal');
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  }, [addTab]);

  // Handler for closing a terminal tab
  const handleCloseTerminal = useCallback(async (id: string) => {
    try {
      await removeTab(id);
    } catch (err) {
      console.error('Failed to close terminal:', err);
    }
  }, [removeTab]);

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
          <PreviewTab />
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

        {/* Terminal Tab */}
        <div
          data-testid="terminal-tab-wrapper"
          className="flex-1 flex flex-col absolute inset-0"
          style={{
            display: activeTab === 'terminal' ? 'flex' : 'none',
          }}
        >
          <TerminalTab
            tabs={tabs}
            activeTabId={activeTabId}
            activeTab={activeTerminalTab}
            isLoading={isLoading}
            error={error}
            onTabSelect={setActiveTerminalTab}
            onTabClose={handleCloseTerminal}
            onTabAdd={handleAddTerminal}
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
