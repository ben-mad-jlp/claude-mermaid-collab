/**
 * Implementation of the complete_skill MCP tool.
 */

import type { CompleteSkillOutput, StateId, WorkItem, WorkItemType } from './types.js';
import { getState, skillToState, getSkillForState } from './state-machine.js';
import { getNextState, buildTransitionContext, resolveToSkillState } from './transitions.js';
import { getSessionState, updateSessionState, type CollabState } from '../tools/collab-state.js';
import { syncTasksFromTaskGraph } from './task-sync.js';
import { updateTaskDiagram } from './task-diagram.js';

/**
 * Find the next pending work item from workItems array (status === 'pending')
 */
function findNextPendingItem(workItems?: WorkItem[]): WorkItem | null {
  if (!workItems || workItems.length === 0) {
    return null;
  }
  return workItems.find((item) => item.status === 'pending') ?? null;
}

/**
 * Find the next item that needs brainstorming (status === 'pending').
 * Used by brainstorm-item-router.
 */
function findNextPendingBrainstormItem(workItems?: WorkItem[]): WorkItem | null {
  if (!workItems || workItems.length === 0) {
    return null;
  }
  return workItems.find((item) => item.status === 'pending') ?? null;
}

/**
 * Find the next code item that needs rough-draft (type === 'code', status === 'brainstormed').
 * Used by rough-draft-item-router.
 */
function findNextPendingRoughDraftItem(workItems?: WorkItem[]): WorkItem | null {
  if (!workItems || workItems.length === 0) {
    return null;
  }
  return workItems.find(
    (item) => item.type === 'code' && item.status === 'brainstormed'
  ) ?? null;
}

/**
 * Handle complete_skill MCP tool call
 */
export async function completeSkill(
  project: string,
  session: string,
  completedSkill: string
): Promise<CompleteSkillOutput> {
  // 1. Read current session state
  const sessionState = await getSessionState(project, session);

  // 2. Determine current state ID
  // Validate that session state matches the completed skill before using it for routing
  // This prevents stale state from causing incorrect routing when skills are manually invoked
  let currentStateId: StateId | null = null;

  if (sessionState.state) {
    // Verify the state's skill matches completedSkill
    const stateSkill = getSkillForState(sessionState.state as StateId);
    if (stateSkill === completedSkill) {
      currentStateId = sessionState.state as StateId;
    } else {
      // State doesn't match skill - log warning and fallback
      console.warn(
        `State mismatch: session.state="${sessionState.state}" has skill "${stateSkill}" ` +
          `but completedSkill="${completedSkill}". Using skillToState fallback.`
      );
      currentStateId = skillToState(completedSkill);
    }
  } else {
    currentStateId = skillToState(completedSkill);
  }

  if (!currentStateId) {
    throw new Error(`Unknown skill: ${completedSkill}`);
  }

  // 3. Build transition context
  // Pass currentItemType from session state for routing decisions
  const context = buildTransitionContext(sessionState, sessionState.currentItemType);

  // 4. Get next state
  let nextStateId = getNextState(currentStateId, context);
  if (!nextStateId) {
    // No transition - workflow complete
    return {
      next_skill: null,
      action: 'none',
    };
  }

  // 4a. If entering a router, select next appropriate item first
  let updatedContext = context;
  let itemUpdates: { currentItem?: number | null; currentItemType?: WorkItemType } = {};

  if (nextStateId === 'brainstorm-item-router' || nextStateId === 'work-item-router') {
    // Brainstorm router: find next item needing brainstorming (status === 'pending')
    const nextItem = findNextPendingBrainstormItem(sessionState.workItems);
    if (nextItem) {
      // Found a pending item - set it as current
      itemUpdates = {
        currentItem: nextItem.number,
        currentItemType: nextItem.type,
      };
      // Rebuild context with the item type for routing
      updatedContext = buildTransitionContext(
        { ...sessionState, currentItem: nextItem.number, workItems: sessionState.workItems },
        nextItem.type
      );
    } else {
      // No pending items - clear currentItem (will route to rough-draft-confirm)
      itemUpdates = {
        currentItem: null,
        currentItemType: undefined,
      };
      updatedContext = buildTransitionContext(
        { ...sessionState, currentItem: null, workItems: sessionState.workItems },
        undefined
      );
    }
  } else if (nextStateId === 'rough-draft-item-router') {
    // Rough-draft router: find next code item needing rough-draft (type === 'code', status === 'brainstormed')
    const nextItem = findNextPendingRoughDraftItem(sessionState.workItems);
    if (nextItem) {
      // Found a code item needing rough-draft
      itemUpdates = {
        currentItem: nextItem.number,
        currentItemType: nextItem.type,
      };
      // Rebuild context with the item info
      updatedContext = buildTransitionContext(
        { ...sessionState, currentItem: nextItem.number, workItems: sessionState.workItems },
        nextItem.type
      );
    } else {
      // No code items need rough-draft - will route to ready-to-implement
      itemUpdates = {
        currentItem: null,
        currentItemType: undefined,
      };
      updatedContext = buildTransitionContext(
        { ...sessionState, currentItem: null, workItems: sessionState.workItems },
        undefined
      );
    }
  }

  // 5. Resolve routing nodes to find next skill-bearing state
  const resolved = resolveToSkillState(nextStateId, updatedContext);
  if (!resolved) {
    return {
      next_skill: null,
      action: 'none',
    };
  }

  // 6. Special handling for execution phase entry
  if (resolved.stateId === 'clear-pre-execute' || resolved.stateId === 'batch-router') {
    try {
      await syncTasksFromTaskGraph(project, session);
    } catch (error) {
      console.error('Failed to sync tasks from task-graph:', error);
      // Continue anyway - may not have a task graph
    }
  }

  // 7. Determine if we should clear
  const shouldClear = resolved.skill === 'collab-clear';

  // 8. Update session state
  await updateSessionState(project, session, {
    state: resolved.stateId,
    // Update phase based on state category
    phase: getPhaseFromState(resolved.stateId),
    // Include item updates if we selected a new work item
    ...itemUpdates,
  });

  // 9. Auto-update diagram during execution phase
  if (sessionState.phase === 'implementation' && sessionState.batches) {
    try {
      await updateTaskDiagram(project, session, sessionState);
    } catch (error) {
      console.error('Failed to update task diagram:', error);
      // Non-fatal - continue
    }
  }

  // 10. Return next skill and action
  // Use updated item info if available, otherwise fall back to session state
  const effectiveState = {
    ...sessionState,
    ...(itemUpdates.currentItem !== undefined && { currentItem: itemUpdates.currentItem }),
  };
  return {
    next_skill: resolved.skill,
    params: buildParams(resolved.stateId, effectiveState),
    action: shouldClear ? 'clear' : 'none',
  };
}

/**
 * Get phase string from state ID
 */
function getPhaseFromState(stateId: StateId): string {
  // Brainstorming phase states
  if (
    stateId.startsWith('brainstorm') ||
    stateId === 'systematic-debugging' ||
    stateId === 'task-planning' ||
    stateId === 'item-type-router' ||
    stateId === 'clear-post-brainstorm' ||
    stateId === 'work-item-router' ||
    stateId === 'clear-post-item'
  ) {
    return 'brainstorming';
  }

  // Rough-draft confirm (transition between phases)
  if (stateId === 'rough-draft-confirm' || stateId === 'clear-pre-rough-batch') {
    return 'rough-draft/confirm';
  }

  // Rough-draft phase states
  if (
    stateId.startsWith('rough-draft') ||
    stateId === 'clear-pre-rough' ||
    stateId === 'clear-post-rough'
  ) {
    return `rough-draft/${stateId.replace('rough-draft-', '')}`;
  }

  // Implementation phase states
  if (
    stateId === 'execute-batch' ||
    stateId === 'batch-router' ||
    stateId === 'clear-pre-execute' ||
    stateId === 'clear-post-batch' ||
    stateId === 'log-batch-complete' ||
    stateId === 'ready-to-implement'
  ) {
    return 'implementation';
  }

  // Completion phase states
  if (stateId === 'workflow-complete' || stateId === 'cleanup' || stateId === 'done') {
    return 'complete';
  }

  return 'brainstorming';
}

/**
 * Build params for next skill based on state
 */
function buildParams(
  stateId: StateId,
  sessionState: { currentItem?: number | null; currentBatch?: number }
): CompleteSkillOutput['params'] {
  const params: CompleteSkillOutput['params'] = {};

  if (sessionState.currentItem !== null && sessionState.currentItem !== undefined) {
    params.item_number = sessionState.currentItem;
  }

  if (sessionState.currentBatch !== undefined) {
    params.batch_index = sessionState.currentBatch;
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Map state ID to skill name (reverse of skillToState)
 */
export function stateToSkill(stateId: StateId): string | null {
  return getSkillForState(stateId);
}
