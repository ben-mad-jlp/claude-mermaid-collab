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
