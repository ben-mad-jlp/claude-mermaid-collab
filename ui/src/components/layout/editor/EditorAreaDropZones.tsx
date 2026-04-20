import { useState } from 'react';
import { useDroppable, useDndMonitor } from '@dnd-kit/core';

function DropHalf({
  id,
  side,
  enabled,
}: {
  id: 'editor-half-left' | 'editor-half-right';
  side: 'left' | 'right';
  enabled: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id, data: { zone: id } });
  const positionClass = side === 'left' ? 'left-0' : 'right-0';
  const highlightClass =
    isOver && enabled
      ? 'bg-accent-500/20 border-2 border-accent-500 dark:bg-accent-400/20 dark:border-accent-400'
      : 'border-2 border-transparent';
  return (
    <div
      ref={setNodeRef}
      data-testid={id}
      data-zone={id}
      data-is-over={isOver || undefined}
      className={`absolute top-0 bottom-0 w-1/2 transition-colors ${positionClass} ${highlightClass}`}
      style={{ pointerEvents: enabled ? 'auto' : 'none' }}
    />
  );
}

/**
 * Two invisible 50% droppable zones layered over the editor area.
 * Must be mounted inside a DndContext ancestor (uses useDndMonitor).
 */
export function EditorAreaDropZones() {
  const [isDragging, setIsDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false),
  });
  return (
    <div
      data-testid="editor-drop-zones"
      data-dragging={isDragging || undefined}
      className="pointer-events-none absolute inset-0"
    >
      <DropHalf id="editor-half-left" side="left" enabled={isDragging} />
      <DropHalf id="editor-half-right" side="right" enabled={isDragging} />
    </div>
  );
}

export default EditorAreaDropZones;
