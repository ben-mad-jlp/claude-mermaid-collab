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
  [key: string]: unknown;
}

/** Context for evaluating transitions */
export interface TransitionContext {
  currentItemType?: 'code' | 'task' | 'bugfix';
  itemsRemaining: boolean;
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

    case 'items_remaining':
      return context.itemsRemaining;

    case 'no_items_remaining':
      return !context.itemsRemaining;

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
    batches?: unknown[];
    currentBatch?: number;
    pendingTasks?: string[];
  },
  currentItemType?: 'code' | 'task' | 'bugfix'
): TransitionContext {
  // Determine if items remaining - check if currentItem is set
  // This is a simplified check; in practice the skill may pass more info
  const itemsRemaining = sessionState.currentItem !== null && sessionState.currentItem !== undefined;

  // Determine if batches remaining
  let batchesRemaining = false;
  if (sessionState.batches && sessionState.currentBatch !== undefined) {
    batchesRemaining = sessionState.currentBatch < sessionState.batches.length;
  } else if (sessionState.pendingTasks) {
    batchesRemaining = sessionState.pendingTasks.length > 0;
  }

  return {
    currentItemType,
    itemsRemaining,
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
 * Condition: current item is brainstormed and ready for interface
 */
export function itemReadyForInterface(state: SessionState): boolean {
  const item = getCurrentWorkItem(state);
  return item !== null && item.status === 'brainstormed';
}

/**
 * Condition: current item has interface doc, ready for pseudocode
 */
export function itemReadyForPseudocode(state: SessionState): boolean {
  const item = getCurrentWorkItem(state);
  return item !== null && item.status === 'interface';
}

/**
 * Condition: current item has pseudocode doc, ready for skeleton
 */
export function itemReadyForSkeleton(state: SessionState): boolean {
  const item = getCurrentWorkItem(state);
  return item !== null && item.status === 'pseudocode';
}

/**
 * Condition: all items complete, ready for handoff
 */
export function readyForHandoff(state: SessionState): boolean {
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
  'brainstormed': ['interface'],
  'interface': ['pseudocode'],
  'pseudocode': ['skeleton'],
  'skeleton': ['complete'],
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
 * Get next state for per-item pipeline flow.
 * Implements the workflow: each item goes through full pipeline before next item starts.
 * Updates item status based on current state and returns next state.
 *
 * Flow:
 * 1. After brainstorm-validating: Mark item as 'brainstormed', go to rough-draft-interface
 * 2. After rough-draft-interface: Mark item as 'interface', go to rough-draft-pseudocode
 * 3. After rough-draft-pseudocode: Mark item as 'pseudocode', go to rough-draft-skeleton
 * 4. After rough-draft-skeleton: Mark item as 'skeleton', go to build-task-graph
 * 5. After build-task-graph: Mark item as 'complete', find next item or go to ready-to-implement
 */
export function getNextStateForPerItemPipeline(
  currentStateId: StateId,
  sessionState: SessionState
): StateId | null {
  // Get current item
  const currentItem = getCurrentWorkItem(sessionState);

  // If no current item, find next pending item
  if (!currentItem) {
    const nextItem = findNextPendingItemInSession(sessionState.workItems);
    if (!nextItem) {
      // All items complete
      return 'ready-to-implement';
    }
    // Start next item's brainstorming
    return 'brainstorm-exploring';
  }

  // Route based on current state and update item status
  switch (currentStateId) {
    case 'brainstorm-validating': {
      // Mark item as brainstormed and route to rough-draft
      const updatedItem = updateItemStatusInSession(currentItem, 'brainstormed');
      // Update in session
      const updatedWorkItems = sessionState.workItems.map((item) =>
        item.number === currentItem.number ? updatedItem : item
      );
      sessionState.workItems = updatedWorkItems;
      return 'rough-draft-interface';
    }

    case 'rough-draft-interface': {
      // Mark item as interface doc created and go to pseudocode
      const updatedItem = updateItemStatusInSession(currentItem, 'interface');
      const updatedWorkItems = sessionState.workItems.map((item) =>
        item.number === currentItem.number ? updatedItem : item
      );
      sessionState.workItems = updatedWorkItems;
      return 'rough-draft-pseudocode';
    }

    case 'rough-draft-pseudocode': {
      // Mark item as pseudocode doc created and go to skeleton
      const updatedItem = updateItemStatusInSession(currentItem, 'pseudocode');
      const updatedWorkItems = sessionState.workItems.map((item) =>
        item.number === currentItem.number ? updatedItem : item
      );
      sessionState.workItems = updatedWorkItems;
      return 'rough-draft-skeleton';
    }

    case 'rough-draft-skeleton': {
      // Mark item as skeleton complete and go to task graph
      const updatedItem = updateItemStatusInSession(currentItem, 'skeleton');
      const updatedWorkItems = sessionState.workItems.map((item) =>
        item.number === currentItem.number ? updatedItem : item
      );
      sessionState.workItems = updatedWorkItems;
      return 'build-task-graph';
    }

    case 'build-task-graph': {
      // Mark item as complete
      const updatedItem = updateItemStatusInSession(currentItem, 'complete');
      const updatedWorkItems = sessionState.workItems.map((item) =>
        item.number === currentItem.number ? updatedItem : item
      );
      sessionState.workItems = updatedWorkItems;

      // Check if more items remain
      const nextItem = findNextPendingItemInSession(updatedWorkItems);
      if (nextItem) {
        // Set current item to next pending item
        sessionState.currentItem = nextItem.number;
        // Start next item from brainstorming
        return 'brainstorm-exploring';
      } else {
        // All items done - clear current item
        sessionState.currentItem = null;
        return 'ready-to-implement';
      }
    }

    default:
      // For other states, use standard transition logic
      return null;
  }
}
