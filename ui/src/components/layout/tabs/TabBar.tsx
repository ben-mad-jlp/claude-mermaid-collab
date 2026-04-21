import React from 'react';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Tab from './Tab';
import TabContextMenu from './TabContextMenu';
import {
  sessionKey,
  useSessionTabs,
  useTabsStore,
  type TabDescriptor,
} from '../../../stores/tabsStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useDataLoader } from '../../../hooks/useDataLoader';
import { promoteCodeFile } from '../../../lib/promote-code-file';

export interface TabBarProps {
  /**
   * Optional external context menu handler. When provided, TabBar delegates
   * right-click to the caller and suppresses its built-in menu.
   */
  onContextMenu?: (e: React.MouseEvent, tab: TabDescriptor) => void;
}

interface SortableTabProps {
  tab: TabDescriptor;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTogglePin: () => void;
  onPromote: () => void;
}

const SortableTab: React.FC<SortableTabProps> = ({
  tab,
  isActive,
  onClick,
  onClose,
  onContextMenu,
  onTogglePin,
  onPromote,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: tab.id, data: { tab } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Tab
        tab={tab}
        isActive={isActive}
        onClick={onClick}
        onClose={onClose}
        onContextMenu={onContextMenu ?? (() => {})}
        onTogglePin={onTogglePin}
        onPromote={onPromote}
      />
    </div>
  );
};

export const TabBar: React.FC<TabBarProps> = ({ onContextMenu }) => {
  const { tabs, activeTabId, rightPaneTabId } = useSessionTabs();
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const pinTab = useTabsStore((s) => s.pinTab);
  const unpinTab = useTabsStore((s) => s.unpinTab);
  const pinTabRight = useTabsStore((s) => s.pinTabRight);
  const promoteToPermanent = useTabsStore((s) => s.promoteToPermanent);

  const [menu, setMenu] = React.useState<{
    tab: TabDescriptor;
    x: number;
    y: number;
  } | null>(null);
  const {
    selectDiagramWithContent,
    selectDocumentWithContent,
    selectDesignWithContent,
    selectSpreadsheetWithContent,
  } = useDataLoader();

  const activateTab = React.useCallback((tab: TabDescriptor) => {
    setActive(tab.id);
    const s = useSessionStore.getState();
    const cs = s.currentSession;
    if (tab.kind === 'embed') {
      return;
    }
    if (tab.kind === 'code-file') {
      return;
    }
    // Blueprints and task-details are documents at their core; task-graph is a
    // first-class view. Without handling these kinds, clicking such a tab left
    // selectedXxxId untouched and the viewer kept showing the previous tab's
    // artifact — producing the "off-by-one" tab switch bug.
    if (tab.kind === 'blueprint' && cs) {
      selectDocumentWithContent(cs.project, cs.name, tab.artifactId);
      return;
    }
    if (tab.kind === 'task-graph') {
      return;
    }
    if (tab.kind === 'task-details' && cs) {
      selectDocumentWithContent(cs.project, cs.name, tab.artifactId);
      return;
    }
    if (tab.kind === 'artifact' && tab.artifactType && cs) {
      const { project, name } = cs;
      switch (tab.artifactType) {
        case 'diagram': selectDiagramWithContent(project, name, tab.artifactId); break;
        case 'document': selectDocumentWithContent(project, name, tab.artifactId); break;
        case 'design': selectDesignWithContent(project, name, tab.artifactId); break;
        case 'spreadsheet': selectSpreadsheetWithContent(project, name, tab.artifactId); break;
        case 'snippet': s.selectSnippet(tab.artifactId); break;
      }
    }
  }, [setActive, selectDiagramWithContent, selectDocumentWithContent, selectDesignWithContent, selectSpreadsheetWithContent]);

  // closeTab updates activeTabId in the tabs store but does not trigger the
  // sessionStore selection / content load that activateTab performs, so the
  // viewer would keep showing the old artifact. After closing, look up the
  // now-active tab and activate it so the viewer follows.
  const handleClose = React.useCallback((id: string) => {
    closeTab(id);
    const cs = useSessionStore.getState().currentSession;
    if (!cs) return;
    const key = sessionKey(cs.project, cs.name);
    const entry = useTabsStore.getState().bySession[key];
    if (!entry?.activeTabId) return;
    const next = entry.tabs.find((t) => t.id === entry.activeTabId);
    if (next) activateTab(next);
  }, [closeTab, activateTab]);

  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent, tab: TabDescriptor) => {
      if (onContextMenu) {
        onContextMenu(e, tab);
        return;
      }
      e.preventDefault();
      setMenu({ tab, x: e.clientX, y: e.clientY });
    },
    [onContextMenu],
  );

  const regularOrdered = React.useMemo(
    () => tabs.filter((t) => !t.isPinned).sort((a, b) => a.order - b.order),
    [tabs],
  );

  const handleCloseOthers = React.useCallback(
    (tab: TabDescriptor) => {
      regularOrdered.forEach((t) => {
        if (t.id !== tab.id) closeTab(t.id);
      });
    },
    [regularOrdered, closeTab],
  );

  const handleCloseToRight = React.useCallback(
    (tab: TabDescriptor) => {
      const idx = regularOrdered.findIndex((t) => t.id === tab.id);
      if (idx < 0) return;
      regularOrdered.slice(idx + 1).forEach((t) => closeTab(t.id));
    },
    [regularOrdered, closeTab],
  );

  const handleCloseAll = React.useCallback(() => {
    // Only close regular (non-pinned) tabs — "Close All" invoked from the
    // regular bar should not cascade to pinned tabs.
    regularOrdered.forEach((t) => closeTab(t.id));
  }, [regularOrdered, closeTab]);

  const permanentTabs = tabs
    .filter((t) => !t.isPinned && !t.isPreview)
    .sort((a, b) => a.order - b.order);
  const previewTabs = tabs
    .filter((t) => !t.isPinned && t.isPreview)
    .sort((a, b) => a.order - b.order);
  const regularTabs = [...permanentTabs, ...previewTabs];

  return (
    <div
      className="flex items-stretch overflow-x-auto whitespace-nowrap border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      role="tablist"
      data-testid="tab-bar"
    >
      <SortableContext
        items={regularTabs.map((t) => t.id)}
        strategy={horizontalListSortingStrategy}
      >
        {permanentTabs.map((tab) => (
          <SortableTab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onClick={() => activateTab(tab)}
            onClose={() => handleClose(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
            onTogglePin={() => pinTab(tab.id)}
            onPromote={() => {
              if (tab.kind === 'code-file') void promoteCodeFile(tab.id);
              else promoteToPermanent(tab.id);
            }}
          />
        ))}
        {previewTabs.length > 0 && <div className="flex-1" aria-hidden="true" />}
        {previewTabs.map((tab) => (
          <SortableTab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onClick={() => activateTab(tab)}
            onClose={() => handleClose(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
            onTogglePin={() => pinTab(tab.id)}
            onPromote={() => {
              if (tab.kind === 'code-file') void promoteCodeFile(tab.id);
              else promoteToPermanent(tab.id);
            }}
          />
        ))}
      </SortableContext>
      {menu && (
        <TabContextMenu
          tab={menu.tab}
          x={menu.x}
          y={menu.y}
          onClose={() => handleClose(menu.tab.id)}
          onCloseOthers={() => handleCloseOthers(menu.tab)}
          onCloseToRight={() => handleCloseToRight(menu.tab)}
          onCloseAll={handleCloseAll}
          onOpenInRightPane={() => pinTabRight(menu.tab.id)}
          hideOpenInRightPane={rightPaneTabId === menu.tab.id}
          onPinToggle={() =>
            menu.tab.isPinned ? unpinTab(menu.tab.id) : pinTab(menu.tab.id)
          }
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
};

TabBar.displayName = 'TabBar';

export default TabBar;
