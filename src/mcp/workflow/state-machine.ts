/**
 * Workflow state machine definitions.
 * Contains all states and their transitions.
 */

import type { StateId, WorkflowState, WorkItem, ItemStatus } from './types.js';
import { getNextStateForPhaseBatching, type SessionState as TransitionSessionState } from './transitions.js';

/**
 * Mapping of internal state names to user-friendly display names
 */
export const STATE_DISPLAY_NAMES: Record<string, string> = {
  // Entry
  'collab-start': 'Starting',
  'gather-goals': 'Gathering Goals',

  // Brainstorming
  'brainstorm-exploring': 'Exploring',
  'brainstorm-clarifying': 'Clarifying',
  'brainstorm-designing': 'Designing',
  'brainstorm-validating': 'Validating',

  // Item-specific paths
  'systematic-debugging': 'Investigating',
  'task-planning': 'Planning Task',

  // Phase transition
  'rough-draft-confirm': 'Confirming',

  // Rough-draft
  'rough-draft-blueprint': 'Creating Blueprint',

  // Execution
  'ready-to-implement': 'Ready',
  'execute-batch': 'Executing',

  // Terminal
  'workflow-complete': 'Finishing',
  'cleanup': 'Cleaning Up',
  'done': 'Done',

  // Vibe mode
  'vibe-active': 'Vibing',

  // Routing nodes
  'work-item-router': 'Routing',
  'brainstorm-item-router': 'Routing',
  'item-type-router': 'Routing',
  'rough-draft-item-router': 'Routing',
  'batch-router': 'Routing',
  'log-batch-complete': 'Logging',
  'bug-review': 'Bug Review',
  'completeness-review': 'Completeness Review',
};

/**
 * Get user-friendly display name for a state.
 * For unknown states, returns the state as-is.
 * @param state - Internal state name
 * @param previousState - Optional previous state (for future use)
 * @returns User-friendly display name
 */
export function getDisplayName(state: string, previousState?: string): string {
  // Check for direct mapping in STATE_DISPLAY_NAMES
  if (state in STATE_DISPLAY_NAMES) {
    return STATE_DISPLAY_NAMES[state];
  }

  // Unknown state - return as-is (fallback)
  return state;
}

/** All workflow states */
export const WORKFLOW_STATES: WorkflowState[] = [
  // ========== Entry ==========
  {
    id: 'collab-start',
    skill: 'collab-start',
    transitions: [
      { to: 'vibe-active', condition: { type: 'session_type', value: 'vibe' } },
      { to: 'gather-goals' },  // default for structured
    ],
  },
  {
    id: 'gather-goals',
    skill: 'gather-session-goals',
    transitions: [{ to: 'brainstorm-item-router' }],
  },

  // ========== Brainstorm item router (routes by type) ==========
  // Routes bugfixes to systematic-debugging, code/task to brainstorm
  // When no pending items, goes to rough-draft-confirm
  // IMPORTANT: no_pending_brainstorm_items must be checked FIRST, before item_type conditions.
  // Otherwise, stale currentItemType from the just-completed item matches and loops back.
  {
    id: 'brainstorm-item-router',
    skill: null,
    transitions: [
      { to: 'rough-draft-confirm', condition: { type: 'no_pending_brainstorm_items' } },
      { to: 'systematic-debugging', condition: { type: 'item_type', value: 'bugfix' } },
      { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'code' } },
      { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'task' } },
    ],
  },

  // ========== Brainstorming states ==========
  {
    id: 'brainstorm-exploring',
    skill: 'brainstorming-exploring',
    transitions: [{ to: 'brainstorm-clarifying' }],
  },
  {
    id: 'brainstorm-clarifying',
    skill: 'brainstorming-clarifying',
    transitions: [{ to: 'brainstorm-designing' }],
  },
  {
    id: 'brainstorm-designing',
    skill: 'brainstorming-designing',
    transitions: [{ to: 'brainstorm-validating' }],
  },
  {
    id: 'brainstorm-validating',
    skill: 'brainstorming-validating',
    transitions: [{ to: 'item-type-router' }],
  },

  // ========== Item type router (routes after brainstorm completion) ==========
  // Tasks go to task-planning then complete
  // Code items go back to brainstorm-item-router (to pick up next item)
  {
    id: 'item-type-router',
    skill: null,
    transitions: [
      { to: 'task-planning', condition: { type: 'item_type', value: 'task' } },
      { to: 'brainstorm-item-router', condition: { type: 'item_type', value: 'code' } },
    ],
  },

  // ========== Task planning (completes after brainstorm) ==========
  {
    id: 'task-planning',
    skill: 'task-planning',
    transitions: [{ to: 'brainstorm-item-router' }],
  },

  // ========== Systematic debugging (bugfixes skip brainstorm) ==========
  {
    id: 'systematic-debugging',
    skill: 'systematic-debugging',
    transitions: [{ to: 'brainstorm-item-router' }],
  },

  // ========== Rough-draft confirm (asks about auto-allow) ==========
  {
    id: 'rough-draft-confirm',
    skill: 'rough-draft-confirm',
    transitions: [{ to: 'rough-draft-item-router' }],
  },

  // ========== Rough-draft item router (code and bugfix items) ==========
  {
    id: 'rough-draft-item-router',
    skill: null,
    transitions: [
      { to: 'rough-draft-blueprint', condition: { type: 'pending_rough_draft_items' } },
      { to: 'ready-to-implement', condition: { type: 'no_pending_rough_draft_items' } },
    ],
  },

  // ========== Rough-draft states ==========
  {
    id: 'rough-draft-blueprint',
    skill: 'rough-draft-blueprint',
    transitions: [{ to: 'rough-draft-item-router' }],
  },

  // ========== Ready to implement (all items documented) ==========
  {
    id: 'ready-to-implement',
    skill: 'ready-to-implement',
    transitions: [{ to: 'batch-router' }],
  },

  // ========== Execution states ==========
  {
    id: 'batch-router',
    skill: null,
    transitions: [
      { to: 'execute-batch', condition: { type: 'batches_remaining' } },
      { to: 'bug-review', condition: { type: 'no_batches_remaining' } },
    ],
  },
  {
    id: 'execute-batch',
    skill: 'executing-plans',
    transitions: [{ to: 'log-batch-complete' }],
  },
  {
    id: 'log-batch-complete',
    skill: null, // Internal logging state
    transitions: [{ to: 'batch-router' }],
  },

  // ========== Review states (after execution, before finishing) ==========
  {
    id: 'bug-review',
    skill: 'executing-plans-bugreview',
    transitions: [{ to: 'completeness-review' }],
  },
  {
    id: 'completeness-review',
    skill: 'executing-plans-completeness',
    transitions: [{ to: 'workflow-complete' }],
  },

  // ========== Terminal states ==========
  {
    id: 'workflow-complete',
    skill: 'finishing-a-development-branch',
    transitions: [{ to: 'cleanup' }],
  },
  {
    id: 'cleanup',
    skill: 'collab-cleanup',
    transitions: [{ to: 'done' }],
  },
  {
    id: 'done',
    skill: null,
    transitions: [],
  },

  // ========== Vibe mode ==========
  {
    id: 'vibe-active',
    skill: 'vibe-active',
    transitions: [
      { to: 'brainstorm-item-router', condition: { type: 'pending_brainstorm_items' } },
      { to: 'cleanup' },
    ],
  },

  // ========== Legacy states (kept for backwards compatibility) ==========
  {
    id: 'work-item-router',
    skill: null,
    transitions: [
      { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'code' } },
      { to: 'brainstorm-exploring', condition: { type: 'item_type', value: 'task' } },
      { to: 'systematic-debugging', condition: { type: 'item_type', value: 'bugfix' } },
      { to: 'ready-to-implement', condition: { type: 'no_items_remaining' } },
    ],
  },
];

/**
 * Get all workflow states
 */
export function getWorkflowStates(): WorkflowState[] {
  return WORKFLOW_STATES;
}

/**
 * Get a specific state by ID
 */
export function getState(id: StateId): WorkflowState | undefined {
  return WORKFLOW_STATES.find((s) => s.id === id);
}

/**
 * Get the skill name for a state
 */
export function getSkillForState(id: StateId): string | null {
  const state = getState(id);
  return state?.skill ?? null;
}

/**
 * Map skill name to state ID
 */
export function skillToState(skill: string): StateId | null {
  const state = WORKFLOW_STATES.find((s) => s.skill === skill);
  return state?.id ?? null;
}

/**
 * Find the next non-complete work item from the array.
 * Returns the first item with status !== 'complete', or undefined if all complete.
 */
export function findNextPendingItem(workItems: WorkItem[]): WorkItem | undefined {
  return workItems.find((item) => item.status !== 'complete');
}

/**
 * Find the next item that needs brainstorming.
 * Returns items with status === 'pending' (bugfixes, code, or task that haven't started).
 * Excludes items that have already been brainstormed or are complete.
 */
export function findNextPendingBrainstormItem(workItems: WorkItem[]): WorkItem | undefined {
  return workItems.find((item) => item.status === 'pending');
}

/**
 * Find the next code or bugfix item that needs rough-draft processing.
 * Returns code or bugfix items with status === 'brainstormed'.
 * Tasks don't go through rough-draft.
 */
export function findNextPendingRoughDraftItem(workItems: WorkItem[]): WorkItem | undefined {
  return workItems.find(
    (item) => (item.type === 'code' || item.type === 'bugfix') && item.status === 'brainstormed'
  );
}

/**
 * Valid transitions for each ItemStatus
 */
const VALID_STATUS_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  'pending': ['brainstormed'],
  'brainstormed': ['complete'],
  'complete': [],
};

/**
 * Update a work item's status with validation.
 * Returns a new WorkItem object (immutable) with the updated status.
 * Throws an error if the transition is invalid.
 */
export function updateItemStatus(
  item: WorkItem,
  newStatus: ItemStatus
): WorkItem {
  const validTransitions = VALID_STATUS_TRANSITIONS[item.status];

  if (!validTransitions.includes(newStatus)) {
    throw new Error(
      `Invalid status transition from '${item.status}' to '${newStatus}' for item ${item.number}`
    );
  }

  return {
    ...item,
    status: newStatus,
  };
}

/**
 * Get the current work item by item number from a list of work items.
 * Returns undefined if no matching item found or if currentItemNumber is not provided.
 */
export function getCurrentWorkItem(
  workItems: WorkItem[],
  currentItemNumber?: number
): WorkItem | undefined {
  if (currentItemNumber === undefined) {
    return undefined;
  }
  return workItems.find((item) => item.number === currentItemNumber);
}

/**
 * Migrate work items from old status naming to new unified pipeline status.
 * - Converts 'documented' status to 'brainstormed' for backwards compatibility.
 * - Converts old intermediate statuses ('interface', 'pseudocode', 'skeleton') to 'complete'.
 * Returns a new array (non-mutating).
 * This handles sessions that were created before the status type change.
 */
export function migrateWorkItems(items: WorkItem[]): WorkItem[] {
  return items.map((item) => {
    // Type assertion needed because item.status could be old values from legacy data
    const currentStatus = item.status as string;

    if (currentStatus === 'documented') {
      return {
        ...item,
        status: 'brainstormed',
      };
    }

    // Migrate old intermediate statuses to 'complete'
    // If they got past brainstorming, consider them ready for implementation
    if (['interface', 'pseudocode', 'skeleton'].includes(currentStatus)) {
      return {
        ...item,
        status: 'complete',
      };
    }

    // Return item unchanged if status is already in new format
    return item;
  });
}

/**
 * Session state interface for phase batching routing
 * Re-export from transitions for convenience
 */
export type SessionState = TransitionSessionState;

/**
 * Get the next state based on current state and work item status.
 * Implements phase batching: all items brainstorm first, then all code items go through rough-draft.
 *
 * Phase batching flow:
 * 1. Brainstorm phase: All items (code, task, bugfix) go through brainstorming
 *    - Bugfixes skip brainstorm, go directly to systematic-debugging → mark 'brainstormed'
 *    - Tasks complete after brainstorm + task-planning
 *    - Code items mark as 'brainstormed' and wait for rough-draft phase
 * 2. Rough-draft phase: Code and bugfix items go through rough-draft
 *    - Code items: brainstormed → blueprint → complete
 *    - Bugfix items: brainstormed → simplified blueprint → complete
 *
 * @param currentState - Current state ID
 * @param sessionState - Current session state with work items
 * @returns Next state ID or null if no valid transition
 */
export function getNextState(
  currentState: string,
  sessionState: SessionState
): string | null {
  // Use the phase batching routing logic from transitions
  return getNextStateForPhaseBatching(currentState as StateId, sessionState);
}
