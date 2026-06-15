/**
 * worker-core — the provider-agnostic discipline engine (see design-worker-core).
 *
 * Public surface of the shared in-process worker every provider adapter uses. The
 * runtime state machine (spawnSubloop + the size-gate→research→implement→verify→
 * fix→review→complete recipe) lands on top of these foundations.
 *
 * Built so far (pure, tested): the typed phase boundaries, the read-only capability
 * invariant, the multi-provider model seam, the fix-loop stuck detector, retry,
 * and the harvested edit/read tools.
 */
export * from './schemas';
export * from './capabilities';
export * from './helpers';
export * from './retry';
export * from './resolve-model';
export * from './events';
export * from './cost';
export * from './subloop';
export * from './orchestrator';
export { makeCoordinatorWorkerDeps, type BridgeOpts } from './coordinator-bridge';
export { buildToolset, WIRED_TOOLS, type ToolCtx } from './tools/registry';
export { applyEdit } from './tools/apply-edit';
export { formatRead, type ReadResult } from './tools/read-file';
