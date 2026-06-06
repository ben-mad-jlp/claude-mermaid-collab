/**
 * systemObjectTree — pure helpers for the Spec Sheet left pane (design §4/§5, P1).
 *
 * Nests the flat `SystemObjectNode[]` (from loadSystemObjects) into a parent/child
 * tree by `parentObjectId`, and resolves a node's coverage state off the inline
 * `Todo.objectRef → requirement` rollup (loadCoverage). The object tree is a TYPED
 * TREE here — never a FleetGraph node-kind (§5 non-negotiable). Coverage tints
 * follow one-red discipline: covered=success, partial=info, uncovered=AMBER.
 */

import type { SystemObjectNode, CoverageRollup, CoverageState } from '@/stores/supervisorStore';

export interface SystemObjectTreeNode extends SystemObjectNode {
  children: SystemObjectTreeNode[];
  depth: number;
}

/** Nest the flat object list by parentObjectId, name-sorted, depth-stamped. */
export function buildSystemObjectTree(nodes: SystemObjectNode[]): SystemObjectTreeNode[] {
  const byId = new Map<string, SystemObjectTreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [], depth: 0 });

  const roots: SystemObjectTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentObjectId ? byId.get(node.parentObjectId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node); // orphans (missing parent) surface as roots, never dropped
  }

  const sortRec = (list: SystemObjectTreeNode[], depth: number) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of list) {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    }
  };
  sortRec(roots, 0);
  return roots;
}

/** Pre-order flatten — for rendering a nested tree as an indented flat list. */
export function flattenTree(roots: SystemObjectTreeNode[]): SystemObjectTreeNode[] {
  const out: SystemObjectTreeNode[] = [];
  const walk = (n: SystemObjectTreeNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** The coverage state for one object, or null when the rollup has no row for it. */
export function coverageStateOf(objectId: string, coverage: CoverageRollup | undefined): CoverageState | null {
  return coverage?.byObject.find((o) => o.objectId === objectId)?.state ?? null;
}

export interface CoverageTint {
  dot: string;
  bg: string;
  label: string;
}

/** One-red discipline: uncovered is amber (warning), never red (danger = escalations). */
export const COVERAGE_TINTS: Record<CoverageState, CoverageTint> = {
  covered: { dot: 'bg-success-500', bg: 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300', label: 'covered' },
  partial: { dot: 'bg-info-500', bg: 'bg-info-100 dark:bg-info-900/40 text-info-700 dark:text-info-300', label: 'partial' },
  uncovered: { dot: 'bg-warning-500', bg: 'bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300', label: 'uncovered' },
};
