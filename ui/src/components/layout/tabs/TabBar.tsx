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
  useSessionTabs,
  useTabsStore,
  type TabDescriptor,
} from '../../../stores/tabsStore';

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
}

const SortableTab: React.FC<SortableTabProps> = ({
  tab,
  isActive,
  onClick,
  onClose,
  onContextMenu,
  onTogglePin,
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
              onClick={() => setActive(tab.id)}
              onClose={() => closeTab(tab.id)}
              onContextMenu={
                onContextMenu ? (e) => onContextMenu(e, tab) : undefined
              }
              onTogglePin={() => pinTab(tab.id)}
            />
          ))}
          {previewTabs.length > 0 && <div className="flex-1" aria-hidden="true" />}
          {previewTabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onClick={() => setActive(tab.id)}
              onClose={() => closeTab(tab.id)}
              onContextMenu={
                onContextMenu ? (e) => onContextMenu(e, tab) : undefined
              }
              onTogglePin={() => pinTab(tab.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
};

TabBar.displayName = 'TabBar';

export default TabBar;
