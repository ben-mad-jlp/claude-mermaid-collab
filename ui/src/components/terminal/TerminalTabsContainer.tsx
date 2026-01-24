import React from 'react';
import { useTerminalTabs } from '../../hooks/useTerminalTabs';
import { TerminalTabBar } from './TerminalTabBar';
import { EmbeddedTerminal } from '../EmbeddedTerminal';

export interface TerminalTabsContainerProps {
  className?: string;
}

export const TerminalTabsContainer: React.FC<TerminalTabsContainerProps> = ({ className = '' }) => {
  const {
    tabs,
    activeTabId,
    activeTab,
    addTab,
    removeTab,
    renameTab,
    setActiveTab,
    reorderTabs,
  } = useTerminalTabs();

  return (
    <div className={`terminal-tabs-container ${className}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                style={{
                  display: tab.id === activeTabId ? 'block' : 'none',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <EmbeddedTerminal
                  config={{ wsUrl: tab.wsUrl }}
                  className="h-full"
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
