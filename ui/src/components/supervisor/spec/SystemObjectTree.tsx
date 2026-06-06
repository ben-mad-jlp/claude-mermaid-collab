/**
 * SystemObjectTree — the Spec Sheet left pane (design §4, P1).
 *
 * The typed system-object tree (Pump-A2 ▸ Valve …), nested by parentObjectId and
 * rendered as an indented selectable list. Each row carries a coverage dot tinted
 * by one-red discipline (covered=success, partial=info, uncovered=amber).
 * Selecting an object scopes the right pane. This is an authoring/spec TREE — it
 * is deliberately NOT a FleetGraph node-kind (§5 non-negotiable).
 */

import React, { useMemo } from 'react';
import type { SystemObjectNode, CoverageRollup } from '@/stores/supervisorStore';
import { buildSystemObjectTree, flattenTree, coverageStateOf, COVERAGE_TINTS } from './objectTreeModel';

export interface SystemObjectTreeProps {
  objects: SystemObjectNode[];
  coverage: CoverageRollup | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const SystemObjectTree: React.FC<SystemObjectTreeProps> = ({ objects, coverage, selectedId, onSelect }) => {
  const flat = useMemo(() => flattenTree(buildSystemObjectTree(objects)), [objects]);

  if (flat.length === 0) {
    return (
      <div data-testid="system-object-tree" className="text-2xs text-gray-500 dark:text-gray-400 p-2">
        No system objects yet.
      </div>
    );
  }

  return (
    <ul data-testid="system-object-tree" className="space-y-0.5 py-1">
      {flat.map((node) => {
        const state = coverageStateOf(node.id, coverage);
        const tint = state ? COVERAGE_TINTS[state] : null;
        const selected = node.id === selectedId;
        return (
          <li key={node.id}>
            <button
              type="button"
              data-testid="system-object-row"
              data-object-id={node.id}
              data-selected={selected || undefined}
              onClick={() => onSelect(node.id)}
              style={{ paddingLeft: `${node.depth * 0.85 + 0.5}rem` }}
              className={`w-full flex items-center gap-1.5 pr-2 py-1 rounded text-left text-2xs transition-colors ${
                selected
                  ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span
                aria-hidden="true"
                title={tint?.label ?? 'no coverage'}
                className={`shrink-0 w-2 h-2 rounded-full ${tint?.dot ?? 'bg-gray-300 dark:bg-gray-600'}`}
              />
              <span className="truncate">{node.name}</span>
              {node.qty > 1 && <span className="ml-auto text-3xs text-gray-400 dark:text-gray-500">×{node.qty}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default SystemObjectTree;
