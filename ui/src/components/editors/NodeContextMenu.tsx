/**
 * Context menu for diagram nodes.
 * Provides Edit, Change Type, Add Transition, and Delete actions.
 */

import React, { useState, useRef, useEffect } from 'react';
import { NodeType } from '@/lib/diagramUtils';

export interface NodeContextMenuProps {
  /** Node ID being edited */
  nodeId: string;
  /** Current node label */
  nodeLabel: string;
  /** Current node type */
  nodeType?: NodeType['name'];
  /** Position for menu (viewport coordinates) */
  position: { x: number; y: number };
  /** Callback when menu should close */
  onClose: () => void;
  /** Callback to update node label */
  onEditLabel: (newLabel: string) => void;
  /** Callback to change node type */
  onChangeType: (newType: NodeType['name']) => void;
  /** Callback to start add transition mode */
  onAddTransition: () => void;
  /** Callback to delete node */
  onDelete: () => void;
}

/**
 * MenuItem component for context menu actions
 */
interface MenuItemProps {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}

const MenuItem: React.FC<MenuItemProps> = ({ onClick, className = '', children }) => {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${className}`}
    >
      {children}
    </button>
  );
};

/**
 * Divider component for menu sections
 */
const Divider: React.FC = () => {
  return <div className="border-t border-gray-200 dark:border-gray-600 my-1" />;
};

/**
 * Type submenu for changing node type
 */
interface TypeSubmenuProps {
  onSelect: (type: NodeType['name']) => void;
  currentType?: NodeType['name'];
}

const TypeSubmenu: React.FC<TypeSubmenuProps> = ({ onSelect, currentType }) => {
  const types: NodeType['name'][] = ['terminal', 'state', 'decision', 'action'];

  return (
    <div className="ml-4 border-l border-gray-200 dark:border-gray-600 pl-2">
      {types.map((type) => (
        <MenuItem
          key={type}
          onClick={() => onSelect(type)}
          className={type === currentType ? 'font-bold' : ''}
        >
          {type}
        </MenuItem>
      ))}
    </div>
  );
};

/**
 * Context menu for diagram nodes.
 * Shows options: Edit, Change Type (submenu), Add Transition, Delete
 */
export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  nodeId,
  nodeLabel,
  nodeType,
  position,
  onClose,
  onEditLabel,
  onChangeType,
  onAddTransition,
  onDelete,
}) => {
  const [showTypeMenu, setShowTypeMenu] = useState(false);
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
    const newLabel = prompt('Enter new label:', nodeLabel);
    if (newLabel && newLabel !== nodeLabel) {
      onEditLabel(newLabel);
    }
    onClose();
  };

  const handleTypeSelect = (type: NodeType['name']) => {
    onChangeType(type);
    onClose();
  };

  const handleAddTransition = () => {
    onAddTransition();
    onClose();
  };

  const handleDelete = () => {
    if (confirm('Delete node "' + nodeId + '"?')) {
      onDelete();
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
      style={{ left: position.x, top: position.y }}
    >
      <MenuItem onClick={handleEditLabel}>Edit Label</MenuItem>

      <MenuItem onClick={() => setShowTypeMenu(!showTypeMenu)}>
        Change Type {'\u25B8'}
      </MenuItem>
      {showTypeMenu && (
        <TypeSubmenu onSelect={handleTypeSelect} currentType={nodeType} />
      )}

      <MenuItem onClick={handleAddTransition}>Add Transition</MenuItem>

      <Divider />

      <MenuItem onClick={handleDelete} className="text-red-600 dark:text-red-400">
        Delete
      </MenuItem>
    </div>
  );
};

export default NodeContextMenu;
