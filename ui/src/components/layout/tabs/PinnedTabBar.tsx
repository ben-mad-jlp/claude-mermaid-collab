import React, { useState } from 'react';
import Tab from './Tab';
import TabContextMenu from './TabContextMenu';
import {
  useSessionTabs,
  useTabsStore,
  type TabDescriptor,
} from '../../../stores/tabsStore';
import { useSessionStore } from '../../../stores/sessionStore';

export const PinnedTabBar: React.FC = () => {
  const { tabs, activeTabId } = useSessionTabs();
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const unpinTab = useTabsStore((s) => s.unpinTab);
  const pinTabRight = useTabsStore((s) => s.pinTabRight);

  const [menu, setMenu] = useState<{
    tab: TabDescriptor;
    x: number;
    y: number;
  } | null>(null);

  const pinned = tabs
    .filter((t) => t.isPinned)
    .sort((a, b) => a.order - b.order);

  const activateTab = (tab: TabDescriptor) => {
    setActive(tab.id);
    const s = useSessionStore.getState();
    if (tab.kind === 'artifact' && tab.artifactType) {
      switch (tab.artifactType) {
        case 'diagram': s.selectDiagram(tab.artifactId); break;
        case 'document': s.selectDocument(tab.artifactId); break;
        case 'design': s.selectDesign(tab.artifactId); break;
        case 'spreadsheet': s.selectSpreadsheet(tab.artifactId); break;
        case 'snippet': s.selectSnippet(tab.artifactId); break;
      }
    }
  };

  if (pinned.length === 0) return null;

  const handleCloseOthers = (tab: TabDescriptor) => {
    pinned.forEach((t) => {
      if (t.id !== tab.id) closeTab(t.id);
    });
  };

  const handleCloseToRight = (tab: TabDescriptor) => {
    const idx = pinned.findIndex((t) => t.id === tab.id);
    if (idx < 0) return;
    pinned.slice(idx + 1).forEach((t) => closeTab(t.id));
  };

  const handleCloseAll = () => {
    // Only close pinned tabs — "Close All" invoked from the pinned bar
    // should not cascade to regular/preview tabs.
    pinned.forEach((t) => closeTab(t.id));
  };

  return (
    <div
      role="tablist"
      aria-label="Pinned tabs"
      data-testid="pinned-tab-bar"
      className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-x-auto"
    >
      {pinned.map((t) => (
        <Tab
          key={t.id}
          tab={t}
          isActive={t.id === activeTabId}
          onClick={() => activateTab(t)}
          onClose={() => {}}
          hideClose
          onTogglePin={() => unpinTab(t.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ tab: t, x: e.clientX, y: e.clientY });
          }}
        />
      ))}
      {menu && (
        <TabContextMenu
          tab={menu.tab}
          x={menu.x}
          y={menu.y}
          onClose={() => closeTab(menu.tab.id)}
          onCloseOthers={() => handleCloseOthers(menu.tab)}
          onCloseToRight={() => handleCloseToRight(menu.tab)}
          onCloseAll={handleCloseAll}
          onOpenInRightPane={() => pinTabRight(menu.tab.id)}
          onPinToggle={() => unpinTab(menu.tab.id)}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
};

PinnedTabBar.displayName = 'PinnedTabBar';

export default PinnedTabBar;
