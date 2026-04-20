/**
 * runBatchAction — dispatch a single action id across many tree nodes in parallel,
 * aggregating success/failure via Promise.allSettled. Caller decides what to do
 * with the result (toast, selection clear, etc.).
 */
import type { TreeNode } from './getActionsForNode';

export type BatchDeps = {
  performDelete: (node: TreeNode) => Promise<void>;
  applyDeprecatedToStore: (node: TreeNode, deprecated: boolean) => Promise<void>;
};

export type BatchResult = {
  ok: number;
  failed: Array<{ node: TreeNode; error: unknown }>;
};

export class UnsupportedBatchAction extends Error {
  readonly actionId: string;
  constructor(actionId: string) {
    super(`Unsupported batch action: ${actionId}`);
    this.name = 'UnsupportedBatchAction';
    this.actionId = actionId;
  }
}

export async function runBatchAction(
  actionId: string,
  nodes: TreeNode[],
  deps: BatchDeps,
): Promise<BatchResult> {
  let handler: ((n: TreeNode) => Promise<void>) | null = null;
  switch (actionId) {
    case 'delete':
      handler = deps.performDelete;
      break;
    case 'deprecate':
      handler = (n) => deps.applyDeprecatedToStore(n, true);
      break;
    case 'undeprecate':
      handler = (n) => deps.applyDeprecatedToStore(n, false);
      break;
  }
  if (!handler) throw new UnsupportedBatchAction(actionId);

  const results = await Promise.allSettled(nodes.map((n) => handler!(n)));
  let ok = 0;
  const failed: Array<{ node: TreeNode; error: unknown }> = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') ok++;
    else failed.push({ node: nodes[i], error: r.reason });
  }
  return { ok, failed };
}
