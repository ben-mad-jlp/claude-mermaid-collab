import React from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Tab from './Tab';
import {
  sessionKey,
  useSessionTabs,
  useTabsStore,
  type TabDescriptor,
} from '../../../stores/tabsStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useDataLoader } from '../../../hooks/useDataLoader';

export interface TabBarProps {
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
    useSortable({ id: tab.id });
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
  const { tabs, activeTabId } = useSessionTabs();
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const reorderTabs = useTabsStore((s) => s.reorderTabs);
  const pinTab = useTabsStore((s) => s.pinTab);
  const promoteToPermanent = useTabsStore((s) => s.promoteToPermanent);
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
      s.selectEmbed(tab.artifactId);
      return;
    }
    if (tab.kind === 'code-file') {
      s.selectPseudoPath(tab.artifactId);
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
      s.selectTaskGraph();
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
        case 'image': s.selectImage(tab.artifactId); break;
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

  const permanentTabs = tabs
    .filter((t) => !t.isPinned && !t.isPreview)
    .sort((a, b) => a.order - b.order);
  const previewTabs = tabs
    .filter((t) => !t.isPinned && t.isPreview)
    .sort((a, b) => a.order - b.order);
  const regularTabs = [...permanentTabs, ...previewTabs];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIndex = regularTabs.findIndex((t) => t.id === active.id);
      const newIndex = regularTabs.findIndex((t) => t.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const newIds = arrayMove(
        regularTabs.map((t) => t.id),
        oldIndex,
        newIndex
      );
      reorderTabs(newIds);
    }
  };

  return (
    <div
      className="flex items-stretch overflow-x-auto whitespace-nowrap border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      role="tablist"
      data-testid="tab-bar"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
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
              onContextMenu={
                onContextMenu ? (e) => onContextMenu(e, tab) : undefined
              }
              onTogglePin={() => pinTab(tab.id)}
              onPromote={() => promoteToPermanent(tab.id)}
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
              onContextMenu={
                onContextMenu ? (e) => onContextMenu(e, tab) : undefined
              }
              onTogglePin={() => pinTab(tab.id)}
              onPromote={() => promoteToPermanent(tab.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
};

TabBar.displayName = 'TabBar';

export default TabBar;
