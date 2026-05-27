import { useRef, type ReactNode } from 'react';

/**
 * A fixed-but-resizable right-side column. The drag handle sits on the LEFT
 * edge (dragging left widens the column). Width is owned by the caller (stored
 * in a zustand store) so it persists across toggles.
 */
export function ResizableColumn({
  width,
  onResize,
  min = 280,
  max = 1000,
  className = '',
  children,
}: {
  width: number;
  onResize: (w: number) => void;
  min?: number;
  max?: number;
  className?: string;
  children: ReactNode;
}) {
  const dragging = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - ev.clientX; // handle on left edge: drag left → wider
      onResize(Math.min(max, Math.max(min, startW + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className={`relative flex-shrink-0 h-full min-h-0 flex flex-col border-l border-gray-200 dark:border-gray-700 ${className}`}
      style={{ width }}
    >
      {/* Drag handle on the left edge */}
      <div
        onMouseDown={onMouseDown}
        className="absolute top-0 bottom-0 left-0 w-1 -ml-0.5 cursor-col-resize hover:bg-blue-500/50 z-10"
      />
      {children}
    </div>
  );
}
