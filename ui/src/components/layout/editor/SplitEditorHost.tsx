import React, { useCallback, useMemo, useState, useRef } from 'react';
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
  /** Optional toolbar rendered between the tab bars and the content area */
  toolbar?: React.ReactNode;
  onSnippetToolbarControls?: (controls: React.ReactNode) => void;
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
  const { editMode, project, session, onContentChange, toolbar, onSnippetToolbarControls } = props;
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

  const [rightPaneControls, setRightPaneControls] = useState<React.ReactNode>(null);
  // Stable ref so PaneContent callback identity doesn't change on every render
  const setRightPaneControlsRef = useRef(setRightPaneControls);
  setRightPaneControlsRef.current = setRightPaneControls;
  const handleRightPaneControls = useCallback((controls: React.ReactNode) => {
    setRightPaneControlsRef.current(controls);
  }, []);

  const leftPaneNode = (
    <PaneContent
      tab={leftTab}
      editMode={editMode}
      project={project}
      session={session}
      onContentChange={leftOnContentChange}
      onSnippetToolbarControls={onSnippetToolbarControls}
    />
  );
  const rightPaneNode = (
    <PaneContent
      tab={rightTab}
      editMode={editMode}
      project={project}
      session={session}
      onContentChange={rightOnContentChange}
      onSnippetToolbarControls={handleRightPaneControls}
    />
  );

  const rightIsActive = showRightPane && activePaneId === 'right';

  const rightNode = showRightPane ? (
    <div
      onMouseDown={() => setActivePaneId('right')}
      data-active-pane={rightIsActive || undefined}
      className={`flex flex-col h-full w-full ${rightIsActive ? 'ring-2 ring-inset ring-accent-500 dark:ring-accent-400' : ''}`}
    >
      {/* Right pane tab bar */}
      <div
        className="flex items-stretch shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        role="tablist"
        data-testid="right-pane-tab-bar"
      >
        {rightTab && (
          <div className="group flex items-center gap-2 px-3 py-1.5 text-sm select-none border-r border-gray-200 dark:border-gray-700 min-w-[120px] max-w-[200px] bg-accent-100 dark:bg-accent-900 border-b-2 border-accent-700">
            <span className="truncate flex-1">{rightTab.name}</span>
            <button
              aria-label="Close right pane"
              data-testid="right-pane-close-button"
              className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                useTabsStore.getState().closeRightPane();
              }}
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {rightPaneControls && (
        <div className="flex items-center gap-1 px-2 py-1 shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
          {rightPaneControls}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPaneNode}
      </div>
    </div>
  ) : (
    rightPaneNode
  );

  const [primarySize, setPrimarySize] = useState<number>(50);
  const handleSizeChange = useCallback((size: number) => {
    setPrimarySize(size);
  }, []);

  const leftColumn = (
    <div className="flex flex-col h-full min-h-0">
      <PinnedTabBar />
      <TabBar />
      {toolbar}
      <div className="relative flex-1 min-h-0">
        <div className="w-full h-full min-w-0 overflow-hidden">
          {leftPaneNode}
        </div>
        <EditorAreaDropZones />
      </div>
    </div>
  );

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
        {showRightPane ? (
          <SplitPane
            primaryContent={leftColumn}
            secondaryContent={rightNode}
            defaultPrimarySize={primarySize}
            onSizeChange={handleSizeChange}
            storageId="editor-split"
          />
        ) : (
          leftColumn
        )}
      </DndContext>
    </div>
  );
}

SplitEditorHost.displayName = 'SplitEditorHost';
export default SplitEditorHost;
