import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TerminalTab } from '../../types/terminal';

export interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabRename: (id: string, name: string) => void;
  onTabAdd: () => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
}

interface SortableTabProps {
  tab: TerminalTab;
  isActive: boolean;
  canClose: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

const SortableTab: React.FC<SortableTabProps> = ({
  tab,
  isActive,
  canClose,
  onSelect,
  onClose,
  onRename,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.name);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleDoubleClick = () => {
    setEditValue(tab.name);
    setIsEditing(true);
  };

  const handleRename = () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const handleInputBlur = () => {
    handleRename();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      data-sortable-id={tab.id}
      role="tab"
      aria-selected={isActive}
      className={`inline-flex items-center gap-2 px-3 py-1.5 border-b-2 cursor-pointer transition-all whitespace-nowrap ${
        isActive
          ? 'border-blue-500 text-blue-600 bg-white'
          : 'border-transparent text-gray-600 hover:bg-gray-50'
      }`}
      onClick={onSelect}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-xs"
      >
        <span className="text-gray-400">⋮⋮</span>
      </div>

      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          className="px-1 py-0 border border-gray-300 rounded focus:outline-none focus:border-blue-500 text-sm"
        />
      ) : (
        <span onDoubleClick={handleDoubleClick} className="text-sm truncate max-w-[120px]">{tab.name}</span>
      )}

      {canClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-2 text-gray-400 hover:text-gray-600 focus:outline-none"
          aria-label="Close tab"
        >
          ✕
        </button>
      )}
    </div>
  );
};

export const TerminalTabBar: React.FC<TerminalTabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabRename,
  onTabAdd,
  onTabReorder,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onTabReorder(oldIndex, newIndex);
      }
    }
  };

  const canClose = tabs.length > 1;

  return (
    <div className="terminal-tab-bar" role="tablist">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex items-center gap-1 overflow-x-auto bg-gray-100 border-b border-gray-300">
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                canClose={canClose}
                onSelect={() => onTabSelect(tab.id)}
                onClose={() => onTabClose(tab.id)}
                onRename={(name) => onTabRename(tab.id, name)}
              />
            ))}
            <button
              type="button"
              onClick={onTabAdd}
              className="ml-auto px-2 py-1 text-gray-600 hover:bg-gray-200 rounded transition-colors text-sm"
              aria-label="Add new tab"
              title="Add new terminal tab"
            >
              +
            </button>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

TerminalTabBar.displayName = 'TerminalTabBar';
