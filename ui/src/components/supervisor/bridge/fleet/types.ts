/**
 * FleetGraph node/edge data shapes (BR-3, design §3/§6/§8).
 */

import type { Node, Edge } from '@xyflow/react';
import type { FunnelKey } from '../funnel';
import type { Liveness } from '@/lib/liveness';

export interface EpicNodeData extends Record<string, unknown> {
  kind: 'epic';
  label: string;
  /** Per-bucket rollup counts of child todos. */
  counts: Record<FunnelKey, number>;
  total: number;
  /**
   * The epic's OWN status bucket (distinct from the child-rollup `counts`): tints
   * the epic header/border so an epic reads its own state at a glance, the same way
   * leaf todos color by bucket. Resolved by `epicBucket` (funnel.ts).
   */
  ownBucket: FunnelKey;
  /**
   * True when the epic is expanded into a framed container — its children are
   * nested React Flow nodes (parentId == this id) and this node paints only the
   * header band + frame at the given size. False/undefined = the compact chip.
   */
  expanded?: boolean;
  /** Container size when expanded (chrome that frames the nested children). */
  width?: number;
  height?: number;
}

export interface TodoNodeData extends Record<string, unknown> {
  kind: 'todo';
  title: string;
  bucket: FunnelKey;
  retryCount: number;
  /** True when a worker on this todo has an open escalation (derived). */
  danger: boolean;
}

export interface WorkerNodeData extends Record<string, unknown> {
  kind: 'worker';
  session: string;
  glyph: string;
  liveness: Liveness;
  contextPercent?: number;
  todoTitle?: string;
}

export type FleetNode =
  | Node<EpicNodeData, 'epic'>
  | Node<TodoNodeData, 'todo'>
  | Node<WorkerNodeData, 'worker'>;

export type FleetEdge = Edge;
