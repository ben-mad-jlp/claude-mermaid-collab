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
import { api } from '@/lib/api';
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
  // Manage terminal ID for the current terminal session
  const [terminalId, setTerminalId] = useState<string | null>(null);

  // Handler for tab changes from BottomTabBar
  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
  }, []);

  // Handler for auto-switch to Chat tab (called by ChatTab when AI UI arrives)
  const handleAutoSwitchToChat = useCallback(() => {
    setActiveTab('chat');
  }, []);

  // Handler for creating a new terminal session
  const handleCreateTerminal = useCallback(async () => {
    // Get the current session from the sessions array or use a default
    // For now, use the first available session or create in a general project context
    const session = sessions.length > 0 ? sessions[0] : null;

    if (!session) {
      console.error('No active session available to create terminal');
      return;
    }

    try {
      // Create a new terminal session via API
      const result = await api.createTerminalSession(session.project, session.name);

      // Update the terminal ID state with the newly created terminal
      setTerminalId(result.id);

      // Auto-switch to terminal tab to display the new terminal
      setActiveTab('terminal');
    } catch (error) {
      console.error('Failed to create terminal:', error);
      // Could show error notification here
    }
  }, [sessions]);

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
          <PreviewTab
            selectedItem={null}
            items={[]}
            onItemSelect={() => {}}
          />
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
            terminal={null}
            hasSession={false}
            onCreateTerminal={handleCreateTerminal}
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
