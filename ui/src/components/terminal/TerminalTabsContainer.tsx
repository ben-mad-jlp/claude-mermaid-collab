import React, { useMemo, useRef, useEffect } from 'react';
import { useTerminalTabs } from '../../hooks/useTerminalTabs';
import { TerminalTabBar } from './TerminalTabBar';
import { EmbeddedTerminal } from '../EmbeddedTerminal';
import { useSessionStore } from '../../stores/sessionStore';

export interface TerminalTabsContainerProps {
  className?: string;
}

export const TerminalTabsContainer: React.FC<TerminalTabsContainerProps> = ({ className = '' }) => {
  // Get current collab session
  const currentSession = useSessionStore(state => state.currentSession);

  // Extract project and session from currentSession
  const project = currentSession?.project || '';
  const session = currentSession?.name || '';

  const {
    tabs,
    activeTabId,
    activeTab,
    isLoading,
    error,
    addTab,
    removeTab,
    renameTab,
    setActiveTab,
    reorderTabs,
  } = useTerminalTabs({ project, session });

  // Memoize terminal config to prevent unnecessary iframe reloads
  const terminalConfig = useMemo(() => ({ wsUrl: '/terminal' }), []);

  // Store refs to terminal wrapper elements for explicit resize triggering
  const terminalRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Trigger resize when active tab changes
  useEffect(() => {
    if (!activeTabId) return;

    const terminalWrapper = terminalRefs.current.get(activeTabId);
    if (!terminalWrapper) return;

    // Trigger resize event on the wrapper to notify ResizeObserver
    // Use double RAF to ensure DOM has settled after visibility change
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Dispatch a resize event which triggers the ResizeObserver
        const resizeEvent = new Event('resize', { bubbles: true });
        terminalWrapper.dispatchEvent(resizeEvent);
      });
    });
  }, [activeTabId]);

  // Handle no session selected
  if (!currentSession) {
    return (
      <div className={`terminal-tabs-container ${className}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', padding: '20px', textAlign: 'center' }}>
          Select a session to use the terminal
        </div>
      </div>
    );
  }

  // Handle loading state
  if (isLoading) {
    return (
      <div className={`terminal-tabs-container ${className}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
          Loading terminals...
        </div>
      </div>
    );
  }

  // Handle error state
  if (error) {
    return (
      <div className={`terminal-tabs-container ${className}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d32f2f', padding: '20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>Error loading terminals</div>
            <div style={{ fontSize: '0.9em' }}>{error.message}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`terminal-tabs-container ${className}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Tab Bar */}
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={setActiveTab}
        onTabClose={removeTab}
        onTabRename={renameTab}
        onTabAdd={addTab}
        onTabReorder={reorderTabs}
      />

      {/* Terminal Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {activeTab ? (
          <>
            {/* Render all terminals, but only show the active one */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) {
                    terminalRefs.current.set(tab.id, el);
                  } else {
                    terminalRefs.current.delete(tab.id);
                  }
                }}
                style={{
                  display: tab.id === activeTabId ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <EmbeddedTerminal
                  config={terminalConfig}
                  sessionId={tab.id}
                />
              </div>
            ))}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
            No terminal selected
          </div>
        )}
      </div>
    </div>
  );
};

TerminalTabsContainer.displayName = 'TerminalTabsContainer';
