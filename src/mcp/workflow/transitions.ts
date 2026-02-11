/**
 * Transition logic for the workflow state machine.
 */

import type { StateId, TransitionCondition, WorkItem, ItemStatus } from './types.js';
import { getState } from './state-machine.js';

/**
 * Session state for workflow
 */
export interface SessionState {
  state: string;
  currentItem: number | null;
  workItems: WorkItem[];
  sessionType?: 'structured' | 'vibe';
  [key: string]: unknown;
}

/** Context for evaluating transitions */
export interface TransitionContext {
  currentItemType?: 'code' | 'task' | 'bugfix';
  sessionType?: 'structured' | 'vibe';
  itemsRemaining: boolean;
  pendingBrainstormItems: boolean;
  pendingRoughDraftItems: boolean;
  batchesRemaining: boolean;
}

/**
 * Evaluate a transition condition against context
 */
export function evaluateCondition(
  condition: TransitionCondition | undefined,
  context: TransitionContext
): boolean {
  // No condition means always transition
  if (!condition) {
    return true;
  }

  switch (condition.type) {
    case 'always':
      return true;

    case 'item_type':
      return context.currentItemType === condition.value;

    case 'session_type':
      return context.sessionType === condition.value;

    case 'items_remaining':
      return context.itemsRemaining;

    case 'no_items_remaining':
      return !context.itemsRemaining;

    case 'pending_brainstorm_items':
      return context.pendingBrainstormItems;

    case 'no_pending_brainstorm_items':
      return !context.pendingBrainstormItems;

    case 'pending_rough_draft_items':
      return context.pendingRoughDraftItems;

    case 'no_pending_rough_draft_items':
      return !context.pendingRoughDraftItems;

    case 'batches_remaining':
      return context.batchesRemaining;

    case 'no_batches_remaining':
      return !context.batchesRemaining;

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = condition;
      return false;
  }
}

/**
 * Get the next state given current state and context
 */
export function getNextState(
  currentStateId: StateId,
  context: TransitionContext
): StateId | null {
  const currentState = getState(currentStateId);
  if (!currentState) {
    return null;
  }

  // Find first matching transition
  for (const transition of currentState.transitions) {
    if (evaluateCondition(transition.condition, context)) {
      return transition.to;
    }
  }

  // No matching transition found
  return null;
}

/**
 * Build transition context from session state
 */
export function buildTransitionContext(
  sessionState: {
    currentItem?: number | null;
    workItems?: WorkItem[];
    batches?: unknown[];
    currentBatch?: number;
    pendingTasks?: string[];
    sessionType?: 'structured' | 'vibe';
  },
  currentItemType?: 'code' | 'task' | 'bugfix'
): TransitionContext {
  // Determine if items remaining - check if currentItem is set
  // This is a simplified check; in practice the skill may pass more info
  const itemsRemaining = sessionState.currentItem !== null && sessionState.currentItem !== undefined;

  // Determine if there are items still needing brainstorming (status === 'pending')
  const pendingBrainstormItems = sessionState.workItems
    ? sessionState.workItems.some((item) => item.status === 'pending')
    : false;

  // Determine if there are code/bugfix items needing rough-draft (status === 'brainstormed', type === 'code' or 'bugfix')
  const pendingRoughDraftItems = sessionState.workItems
    ? sessionState.workItems.some(
        (item) => (item.type === 'code' || item.type === 'bugfix') && item.status === 'brainstormed'
      )
    : false;

  // Determine if batches remaining
  let batchesRemaining = false;
  if (sessionState.batches && sessionState.currentBatch !== undefined) {
    batchesRemaining = sessionState.currentBatch < sessionState.batches.length;
  } else if (sessionState.pendingTasks) {
    batchesRemaining = sessionState.pendingTasks.length > 0;
  }

  return {
    currentItemType,
    sessionType: sessionState.sessionType,
    itemsRemaining,
    pendingBrainstormItems,
    pendingRoughDraftItems,
    batchesRemaining,
  };
}

/**
 * Resolve routing nodes to find the next skill-bearing state.
 * Routing nodes (skill: null) are traversed automatically.
 */
export function resolveToSkillState(
  startStateId: StateId,
  context: TransitionContext,
  maxIterations = 10
): { stateId: StateId; skill: string | null } | null {
  let currentId = startStateId;
  let iterations = 0;

  while (iterations < maxIterations) {
    const state = getState(currentId);
    if (!state) {
      return null;
    }

    // If this state has a skill, we're done
    if (state.skill !== null) {
      return { stateId: currentId, skill: state.skill };
    }

    // This is a routing node - find next state
    const nextId = getNextState(currentId, context);
    if (!nextId) {
      // Terminal routing node with no matching transition
      return { stateId: currentId, skill: null };
    }

    currentId = nextId;
    iterations++;
  }

  // Max iterations reached - likely a bug in state machine
  throw new Error(`Max iterations reached resolving from ${startStateId}`);
}

/**
 * Get the current work item from session state
 */
export function getCurrentWorkItem(state: SessionState): WorkItem | null {
  if (state.currentItem === null || state.currentItem === undefined) {
    return null;
  }
  return state.workItems.find((item) => item.number === state.currentItem) ?? null;
}

/**
 * Condition: current item is brainstormed and ready for blueprint
 */
export function itemReadyForBlueprint(state: SessionState): boolean {
  const item = getCurrentWorkItem(state);
  return item !== null && item.status === 'brainstormed';
}

/**
 * Condition: all items complete, ready for implementation
 */
export function readyForImplementation(state: SessionState): boolean {
  return state.workItems.every((item) => item.status === 'complete');
}

/**
 * Find next non-complete item from work items array.
 * Returns the first item with status !== 'complete', or null if all complete.
 */
export function findNextPendingItemInSession(workItems: WorkItem[]): WorkItem | null {
  if (!workItems || workItems.length === 0) {
    return null;
  }
  const pending = workItems.find((item) => item.status !== 'complete');
  return pending ?? null;
}

/**
 * Import updateItemStatus from state-machine module to avoid circular dependency
 * This would be: import { updateItemStatus } from './state-machine.js';
 * But we need to handle it carefully to avoid circular imports.
 * For now, we'll inline the validation logic here.
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  'pending': ['brainstormed'],
  'brainstormed': ['complete'],
  'complete': [],
};

/**
 * Update item status with validation (mirrors updateItemStatus from state-machine.ts)
 * Returns updated item, throws on invalid transition
 */
function updateItemStatusInSession(item: WorkItem, newStatus: string): WorkItem {
  const validTransitions = VALID_STATUS_TRANSITIONS[item.status];
  if (!validTransitions || !validTransitions.includes(newStatus)) {
    throw new Error(
      `Invalid status transition from '${item.status}' to '${newStatus}' for item ${item.number}`
    );
  }
  return {
    ...item,
    status: newStatus as any,
  };
}

/**
 * Get the item status update that should happen when completing a given skill state.
 * Returns the new status, or null if no status update is needed for this state.
 *
 * This is the single source of truth for which states trigger item status updates.
 */
export function getStatusUpdateForSkill(stateId: StateId): ItemStatus | null {
  switch (stateId) {
    case 'brainstorm-validating':
      return 'brainstormed';
    case 'task-planning':
    case 'rough-draft-blueprint':
      return 'complete';
    case 'systematic-debugging':
      return 'brainstormed';
    default:
      return null;
  }
}

/**
 * Get next state for phase batching flow.
 * Implements the workflow: all items brainstorm first, then all code items go through rough-draft.
 * Updates item status based on current state and returns next state.
 *
 * Phase Batching Flow:
 * 1. Brainstorm Phase: Items are processed one at a time
 *    - Bugfixes: systematic-debugging → mark as 'brainstormed' → back to router
 *    - Tasks: brainstorm → task-planning → mark complete → back to router
 *    - Code: brainstorm → mark as 'brainstormed' → back to router
 * 2. Rough-Draft Phase (code and bugfix items):
 *    - Code: blueprint → build-task-graph → mark complete → back to router
 *    - Bugfix: simplified blueprint → mark complete → back to router
 */
export function getNextStateForPhaseBatching(
  currentStateId: StateId,
  sessionState: SessionState
): StateId | null {
  // Get current item
  const currentItem = getCurrentWorkItem(sessionState);

  // Update item status using the shared helper
  const statusUpdate = getStatusUpdateForSkill(currentStateId);
  if (statusUpdate && currentItem) {
    sessionState.workItems = sessionState.workItems.map((item) =>
      item.number === currentItem.number ? { ...item, status: statusUpdate } : item
    );
  }

  // Route based on current state
  switch (currentStateId) {
    // ========== Brainstorm Phase Completion ==========
    case 'brainstorm-validating':
      if (!currentItem) return null;
      return 'item-type-router';

    case 'task-planning':
      if (!currentItem) return null;
      return 'brainstorm-item-router';

    case 'systematic-debugging':
      if (!currentItem) return null;
      return 'brainstorm-item-router';

    // ========== Rough-Draft Phase ==========
    case 'rough-draft-blueprint':
      if (!currentItem) return null;
      return 'rough-draft-item-router';

    default:
      return null;
  }
}

/**
 * Legacy function for backwards compatibility.
 * @deprecated Use getNextStateForPhaseBatching instead
 */
export function getNextStateForPerItemPipeline(
  currentStateId: StateId,
  sessionState: SessionState
): StateId | null {
  return getNextStateForPhaseBatching(currentStateId, sessionState);
}
