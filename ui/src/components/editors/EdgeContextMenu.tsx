/**
 * Context menu for diagram edges.
 * Provides Edit Label, Change Origin/Destination, and Delete actions.
 */

import React, { useRef, useEffect } from 'react';

export interface EdgeContextMenuProps {
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Current edge label */
  edgeLabel?: string;
  /** Position for menu (viewport coordinates) */
  position: { x: number; y: number };
  /** Callback when menu should close */
  onClose: () => void;
  /** Callback to update edge label */
  onEditLabel: (newLabel: string) => void;
  /** Callback to change edge origin (enters selection mode) */
  onChangeOrigin: () => void;
  /** Callback to change edge destination (enters selection mode) */
  onChangeDestination: () => void;
  /** Callback to delete edge */
  onDelete: () => void;
}

/**
 * MenuItem component for context menu actions
 */
const MenuItem: React.FC<{
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}> = ({ onClick, className = '', children }) => (
  <button
    role="menuitem"
    onClick={onClick}
    className={`w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 transition-colors ${className}`}
  >
    {children}
  </button>
);

/**
 * Divider component for separating menu sections
 */
const Divider: React.FC = () => (
  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
);

/**
 * Context menu for diagram edges.
 * Shows options: Edit Label, Change Origin, Change Destination, Delete
 */
export const EdgeContextMenu: React.FC<EdgeContextMenuProps> = ({
  sourceId,
  targetId,
  edgeLabel,
  position,
  onClose,
  onEditLabel,
  onChangeOrigin,
  onChangeDestination,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleEditLabel = () => {
    const newLabel = prompt('Enter edge label:', edgeLabel || '');
    if (newLabel !== null) {
      // Allow empty string to remove label
      onEditLabel(newLabel);
    }
    onClose();
  };

  const handleChangeOrigin = () => {
    onChangeOrigin(); // Parent enters selection mode
    onClose();
  };

  const handleChangeDestination = () => {
    onChangeDestination();
    onClose();
  };

  const handleDelete = () => {
    if (confirm(`Delete edge from "${sourceId}" to "${targetId}"?`)) {
      onDelete();
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-300 dark:border-gray-600 py-1 z-50 min-w-max"
      style={{ left: position.x, top: position.y }}
      data-testid="edge-context-menu"
    >
      <MenuItem onClick={handleEditLabel}>Edit Label</MenuItem>
      <MenuItem onClick={handleChangeOrigin}>Change Origin</MenuItem>
      <MenuItem onClick={handleChangeDestination}>Change Destination</MenuItem>

      <Divider />

      <MenuItem
        onClick={handleDelete}
        className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900"
      >
        Delete
      </MenuItem>
    </div>
  );
};

export default EdgeContextMenu;
