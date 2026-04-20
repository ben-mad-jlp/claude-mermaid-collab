import React, { useEffect, useRef } from 'react';
import type { TabDescriptor } from '../../../stores/tabsStore';

export interface TabContextMenuProps {
  tab: TabDescriptor;
  x: number;
  y: number;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onPinToggle: () => void;
  onReveal: () => void;
  onDismiss: () => void;
}

export const TabContextMenu: React.FC<TabContextMenuProps> = ({
  tab,
  x,
  y,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onPinToggle,
  onReveal,
  onDismiss,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="tab-context-menu"
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1 min-w-max"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <button
        role="menuitem"
        data-testid="tab-menu-close"
        onClick={() => handle(onClose)}
        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
      >
        Close
      </button>
      <button
        role="menuitem"
        data-testid="tab-menu-close-others"
        onClick={() => handle(onCloseOthers)}
        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
      >
        Close Others
      </button>
      <button
        role="menuitem"
        data-testid="tab-menu-close-to-right"
        onClick={() => handle(onCloseToRight)}
        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
      >
        Close to the Right
      </button>
      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
      <button
        role="menuitem"
        data-testid="tab-menu-pin-toggle"
        onClick={() => handle(onPinToggle)}
        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
      >
        {tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
      </button>
      <button
        role="menuitem"
        data-testid="tab-menu-reveal"
        onClick={() => handle(onReveal)}
        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
      >
        Reveal in Sidebar
      </button>
    </div>
  );
};

export default TabContextMenu;
