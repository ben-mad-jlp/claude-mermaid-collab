/**
 * Sidebar Node Context Menu
 *
 * Floating context menu for sidebar tree nodes. Mirrors the pattern of
 * ui/src/components/diagram/ContextMenu.tsx but is data-driven via the
 * MenuAction list produced by getActionsForNode.
 */

import React, { useEffect, useRef } from 'react';
import {
  getActionsForNode,
  getActionsForSelection,
  type MenuAction,
  type TreeNode,
  type NodeActionsCtx,
} from './getActionsForNode';

interface BaseProps {
  /** Mouse X position for menu placement */
  x: number;
  /** Mouse Y position for menu placement */
  y: number;
  /** Callback when menu should close */
  onClose: () => void;
  /** Callback invoked with the action id and target nodes when a menu item is clicked */
  onAction: (actionId: string, targetNodes: TreeNode[]) => void;
  /** Optional context used when computing actions for the target node(s) */
  ctx?: NodeActionsCtx;
  /** Optional override for the actions list; otherwise computed from node(s) + ctx */
  actions?: MenuAction[];
}

export type SidebarNodeContextMenuProps =
  | (BaseProps & { node: TreeNode; nodes?: never })
  | (BaseProps & { nodes: TreeNode[]; node?: never });

export const SidebarNodeContextMenu: React.FC<SidebarNodeContextMenuProps> = (
  props
) => {
  const { x, y, onAction, onClose, ctx, actions } = props;
  const node = (props as { node?: TreeNode }).node;
  const nodes = (props as { nodes?: TreeNode[] }).nodes;

  const menuRef = useRef<HTMLDivElement>(null);

  const targetNodes: TreeNode[] = nodes ?? (node ? [node] : []);
  const resolvedActions =
    actions ??
    (targetNodes.length > 1
      ? getActionsForSelection(targetNodes, ctx)
      : targetNodes.length === 1
        ? getActionsForNode(targetNodes[0], ctx)
        : []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const titleText =
    targetNodes.length > 1
      ? `${targetNodes.length} items selected`
      : targetNodes.length === 1
        ? targetNodes[0].name
        : null;

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="sidebar-node-context-menu"
      className="fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1 min-w-max"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {titleText !== null && (
        <div
          data-testid="sidebar-node-context-menu-title"
          className="px-3 py-1 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700"
        >
          {titleText}
        </div>
      )}
      {resolvedActions.map((action) => (
        <React.Fragment key={action.id}>
          {action.separator && (
            <div
              key={`sep-${action.id}`}
              className="border-t border-gray-200 dark:border-gray-700 my-1"
            />
          )}
          <button
            role="menuitem"
            key={action.id}
            data-testid={`menu-item-${action.id}`}
            disabled={action.disabled}
            title={action.tooltip}
            onClick={
              action.disabled
                ? undefined
                : () => {
                    onAction(action.id, targetNodes);
                    onClose();
                  }
            }
            className={
              'w-full text-left px-3 py-1.5 text-xs ' +
              (action.disabled
                ? 'opacity-50 cursor-not-allowed '
                : 'cursor-pointer ') +
              (action.destructive
                ? 'hover:bg-red-50 dark:hover:bg-red-900 text-red-700 dark:text-red-400'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100')
            }
          >
            {action.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default SidebarNodeContextMenu;
