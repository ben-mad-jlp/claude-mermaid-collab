import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TabDescriptor } from '../../../stores/tabsStore';

export interface TabContextMenuProps {
  tab: TabDescriptor;
  x: number;
  y: number;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onOpenInRightPane: () => void;
  onPinToggle: () => void;
  onDismiss: () => void;
  /** When true, hides "Open in Right Pane" (e.g. already in right pane). */
  hideOpenInRightPane?: boolean;
}

export const TabContextMenu: React.FC<TabContextMenuProps> = ({
  tab,
  x,
  y,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onOpenInRightPane,
  onPinToggle,
  onDismiss,
  hideOpenInRightPane,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, y - rect.height);
      if (top + rect.height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - rect.height - margin);
      }
    }
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [x, y, pos.left, pos.top]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onDismiss]);

  const handle = (cb: () => void) => {
    cb();
    onDismiss();
  };

  const itemClass =
    'w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors';

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="tab-context-menu"
      className="fixed flex flex-col bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1 min-w-max"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      <button
        role="menuitem"
        data-testid="tab-context-close"
        onClick={() => handle(onClose)}
        className={itemClass}
      >
        Close
      </button>
      <button
        role="menuitem"
        data-testid="tab-context-close-others"
        onClick={() => handle(onCloseOthers)}
        className={itemClass}
      >
        Close Others
      </button>
      <button
        role="menuitem"
        data-testid="tab-context-close-to-right"
        onClick={() => handle(onCloseToRight)}
        className={itemClass}
      >
        Close to the Right
      </button>
      <button
        role="menuitem"
        data-testid="tab-context-close-all"
        onClick={() => handle(onCloseAll)}
        className={itemClass}
      >
        Close All
      </button>
      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
      {!hideOpenInRightPane && (
        <button
          role="menuitem"
          data-testid="tab-context-open-right"
          onClick={() => handle(onOpenInRightPane)}
          className={itemClass}
        >
          Open in Right Pane
        </button>
      )}
      <button
        role="menuitem"
        data-testid="tab-context-pin-toggle"
        onClick={() => handle(onPinToggle)}
        className={itemClass}
      >
        {tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
      </button>
    </div>
  );
};

export default TabContextMenu;
