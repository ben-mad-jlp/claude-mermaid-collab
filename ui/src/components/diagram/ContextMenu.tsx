/**
 * Context Menu Component
 *
 * Displays a floating context menu when users click on diagram elements
 * (nodes or edges) in edit mode. Provides actions to edit, modify, or delete
 * the selected element.
 */

import React, { useEffect, useRef } from 'react';

export interface ContextMenuProps {
  /** Mouse X position for menu placement */
  x: number;
  /** Mouse Y position for menu placement */
  y: number;
  /** Type of element that was clicked */
  type: 'node' | 'edge';
  /** ID of the clicked element */
  targetId: string;
  /** Callback when menu should close */
  onClose: () => void;
  /** Callback when user edits label/description */
  onEditLabel: (id: string) => void;
  /** Callback when user changes node type (node only) */
  onChangeType: (id: string) => void;
  /** Callback when user deletes element */
  onDelete: (id: string) => void;
  /** Callback when user changes edge origin (edge only) */
  onChangeOrigin?: (id: string) => void;
  /** Callback when user changes edge destination (edge only) */
  onChangeDest?: (id: string) => void;
  /** Callback when user adds transition from node (node only) */
  onAddTransition?: (id: string) => void;
}

/**
 * ContextMenu component for visual diagram editing
 *
 * Displays different menu options based on element type:
 * - Nodes: Edit Description, Add Transition, Delete Node
 * - Edges: Edit Label, Change Origin, Change Destination, Delete Arrow
 *
 * @example
 * ```tsx
 * <ContextMenu
 *   x={200}
 *   y={300}
 *   type="node"
 *   targetId="state-1"
 *   onClose={() => setContextMenu(null)}
 *   onEditLabel={(id) => editNodeLabel(id)}
 *   onDelete={(id) => deleteNode(id)}
 *   onAddTransition={(id) => addTransition(id)}
 * />
 * ```
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  type,
  targetId,
  onClose,
  onEditLabel,
  onChangeType,
  onDelete,
  onChangeOrigin,
  onChangeDest,
  onAddTransition,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside the menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Handle Escape key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Add listeners
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Handle menu item clicks
  const handleMenuItemClick = (callback: (id: string) => void) => {
    callback(targetId);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1 min-w-max"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
      data-testid="context-menu"
    >
      {type === 'node' ? (
        <>
          {/* Node context menu options */}
          <button
            role="menuitem"
            onClick={() => handleMenuItemClick(onEditLabel)}
            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
            data-testid="menu-edit-description"
          >
            Edit Description
          </button>
          <button
            role="menuitem"
            onClick={() => {
              if (onAddTransition) {
                handleMenuItemClick(onAddTransition);
              }
            }}
            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
            data-testid="menu-add-transition"
          >
            Add Transition
          </button>
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            role="menuitem"
            onClick={() => handleMenuItemClick(onDelete)}
            className="w-full text-left px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900 text-sm text-red-700 dark:text-red-400 transition-colors"
            data-testid="menu-delete-node"
          >
            Delete Node
          </button>
        </>
      ) : (
        <>
          {/* Edge context menu options */}
          <button
            role="menuitem"
            onClick={() => handleMenuItemClick(onEditLabel)}
            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
            data-testid="menu-edit-label"
          >
            Edit Label
          </button>
          <button
            role="menuitem"
            onClick={() => {
              if (onChangeOrigin) {
                handleMenuItemClick(onChangeOrigin);
              }
            }}
            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
            data-testid="menu-change-origin"
          >
            Change Origin
          </button>
          <button
            role="menuitem"
            onClick={() => {
              if (onChangeDest) {
                handleMenuItemClick(onChangeDest);
              }
            }}
            className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors"
            data-testid="menu-change-destination"
          >
            Change Destination
          </button>
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            role="menuitem"
            onClick={() => handleMenuItemClick(onDelete)}
            className="w-full text-left px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900 text-sm text-red-700 dark:text-red-400 transition-colors"
            data-testid="menu-delete-arrow"
          >
            Delete Arrow
          </button>
        </>
      )}
    </div>
  );
};

export default ContextMenu;
