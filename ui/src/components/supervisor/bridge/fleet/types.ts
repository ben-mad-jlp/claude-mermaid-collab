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
