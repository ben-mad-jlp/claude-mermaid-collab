import React, { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { SplitPane } from '../SplitPane';
import EditorAreaDropZones from './EditorAreaDropZones';
import PaneContent from './PaneContent';
import RightPaneCloseButton from './RightPaneCloseButton';
import PinnedTabBar from '../tabs/PinnedTabBar';
import TabBar from '../tabs/TabBar';
import {
  sessionKey,
  useSessionTabs,
  useTabsStore,
  type PaneId,
  type TabDescriptor,
} from '@/stores/tabsStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { Item } from '@/types';

export interface SplitEditorHostProps {
  /** @deprecated unused — SplitEditorHost now resolves tabs from tabsStore */
  leftItem?: Item | null;
  /** @deprecated unused — SplitEditorHost now resolves tabs from tabsStore */
  rightItem?: Item | null;
  editMode: boolean;
  project?: string;
  session?: string;
  onContentChange?: (itemId: string, content: string, pane: PaneId) => void;
}

// Exported for unit testing
export function buildDragEndHandler(deps: {
  getTabs: () => TabDescriptor[];
  getRightPaneTabId: () => string | null;
  pinTabRight: (id: string) => void;
  unpinTabRight: (id?: string) => void;
  reorderTabs: (ids: string[]) => void;
}) {
  return (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const data = (active.data?.current ?? {}) as { tab?: TabDescriptor };
    const activeTab = data.tab;
    if (!activeTab) return;
    const overData = (over.data?.current ?? {}) as { zone?: string };
    const zone = overData.zone;
    if (zone === 'editor-half-right') {
      deps.pinTabRight(activeTab.id);
      return;
    }
    if (zone === 'editor-half-left') {
      if (deps.getRightPaneTabId() === activeTab.id) {
        deps.unpinTabRight(activeTab.id);
      }
      return;
    }
    // Intra-pane reorder (single list)
    if (active.id === over.id) return;
    const tabs = deps.getTabs();
    const oldIdx = tabs.findIndex((t) => t.id === active.id);
    const newIdx = tabs.findIndex((t) => t.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextIds = arrayMove(tabs, oldIdx, newIdx).map((t) => t.id);
    deps.reorderTabs(nextIds);
  };
}

function getCurrentEntry() {
  const cs = useSessionStore.getState().currentSession;
  if (!cs || !cs.project || !cs.name) return null;
  const key = sessionKey(cs.project, cs.name);
  return useTabsStore.getState().bySession[key] ?? null;
}

export function SplitEditorHost(props: SplitEditorHostProps) {
  const { editMode, project, session, onContentChange } = props;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = useMemo(
    () =>
      buildDragEndHandler({
        getTabs: () => getCurrentEntry()?.tabs ?? [],
        getRightPaneTabId: () => getCurrentEntry()?.rightPaneTabId ?? null,
        pinTabRight: (id) => useTabsStore.getState().pinTabRight(id),
        unpinTabRight: (id) => useTabsStore.getState().unpinTabRight(id),
        reorderTabs: (ids) => useTabsStore.getState().reorderTabs(ids),
      }),
    [],
  );

  const sessionTabs = useSessionTabs();
  const { tabs, activeTabId, rightPaneTabId } = sessionTabs;
  const leftTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const rightTab = rightPaneTabId
    ? tabs.find((t) => t.id === rightPaneTabId) ?? null
    : null;

  const showRightPane = rightPaneTabId != null;
  const activePaneId = sessionTabs.activePaneId;
  const setActivePaneId = useTabsStore((s) => s.setActivePaneId);

  const leftOnContentChange = onContentChange
    ? (id: string, c: string) => onContentChange(id, c, 'left')
    : undefined;
  const rightOnContentChange = onContentChange
    ? (id: string, c: string) => onContentChange(id, c, 'right')
    : undefined;

  const leftPaneNode = (
    <PaneContent
      tab={leftTab}
      editMode={editMode}
      project={project}
      session={session}
      onContentChange={leftOnContentChange}
    />
  );
  const rightPaneNode = (
    <PaneContent
      tab={rightTab}
      editMode={editMode}
      project={project}
      session={session}
      onContentChange={rightOnContentChange}
    />
  );

  const leftIsActive = showRightPane && activePaneId === 'left';
  const rightIsActive = showRightPane && activePaneId === 'right';

  const leftNode = showRightPane ? (
    <div
      onMouseDown={() => setActivePaneId('left')}
      data-active-pane={leftIsActive || undefined}
      className={`h-full w-full ${leftIsActive ? 'ring-2 ring-inset ring-accent-500 dark:ring-accent-400' : ''}`}
    >
      {leftPaneNode}
    </div>
  ) : (
    leftPaneNode
  );
  const rightNode = showRightPane ? (
    <div
      onMouseDown={() => setActivePaneId('right')}
      data-active-pane={rightIsActive || undefined}
      className={`group relative h-full w-full ${rightIsActive ? 'ring-2 ring-inset ring-accent-500 dark:ring-accent-400' : ''}`}
    >
      <RightPaneCloseButton onClose={() => useTabsStore.getState().closeRightPane()} />
      {rightPaneNode}
    </div>
  ) : (
    rightPaneNode
  );

  const [primarySize, setPrimarySize] = useState<number>(50);
  const handleSizeChange = useCallback((size: number) => {
    setPrimarySize(size);
  }, []);

  return (
    <div
      className="flex flex-col h-full min-h-0"
      data-testid="split-editor-host"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <PinnedTabBar />
        <TabBar />
        <div className="relative flex-1 min-h-0">
          {showRightPane ? (
            <SplitPane
              primaryContent={leftNode}
              secondaryContent={rightNode}
              defaultPrimarySize={primarySize}
              onSizeChange={handleSizeChange}
              storageId="editor-split"
            />
          ) : (
            <div className="w-full h-full min-w-0 overflow-hidden">
              {leftNode}
            </div>
          )}
          <EditorAreaDropZones />
        </div>
      </DndContext>
    </div>
  );
}

SplitEditorHost.displayName = 'SplitEditorHost';
export default SplitEditorHost;
