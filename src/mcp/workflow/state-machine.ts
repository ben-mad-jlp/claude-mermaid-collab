/**
 * Workflow state machine definitions.
 * Contains all states and their transitions.
 */

import type { StateId, WorkflowState, WorkItem, ItemStatus } from './types.js';
import { getNextStateForPerItemPipeline, type SessionState as TransitionSessionState } from './transitions.js';

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

  // Rough-draft
  'rough-draft-interface': 'Defining Interfaces',
  'rough-draft-pseudocode': 'Writing Pseudocode',
  'rough-draft-skeleton': 'Building Skeleton',
  'build-task-graph': 'Building Tasks',
  'rough-draft-handoff': 'Preparing Handoff',

  // Execution
  'ready-to-implement': 'Ready',
  'execute-batch': 'Executing',

  // Terminal
  'workflow-complete': 'Finishing',
  'cleanup': 'Cleaning Up',
  'done': 'Done',

  // Routing nodes
  'work-item-router': 'Routing',
  'item-type-router': 'Routing',
  'batch-router': 'Routing',
  'log-batch-complete': 'Logging',
};

/**
 * Get user-friendly display name for a state.
 * For clear-* states, returns "Context Check".
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

  // Handle clear-* states
  if (state.startsWith('clear-')) {
    return 'Context Check';
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
    transitions: [{ to: 'gather-goals' }],
  },
  {
    id: 'gather-goals',
    skill: 'gather-session-goals',
    transitions: [{ to: 'clear-pre-item' }],
  },

  // ========== Pre-item clear ==========
  {
    id: 'clear-pre-item',
    skill: 'collab-clear',
    transitions: [{ to: 'work-item-router' }],
  },

  // ========== Work item router (routing node) ==========
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

  // ========== Brainstorming states ==========
  {
    id: 'brainstorm-exploring',
    skill: 'brainstorming-exploring',
    transitions: [{ to: 'clear-bs1' }],
  },
  {
    id: 'clear-bs1',
    skill: 'collab-clear',
    transitions: [{ to: 'brainstorm-clarifying' }],
  },
  {
    id: 'brainstorm-clarifying',
    skill: 'brainstorming-clarifying',
    transitions: [{ to: 'clear-bs2' }],
  },
  {
    id: 'clear-bs2',
    skill: 'collab-clear',
    transitions: [{ to: 'brainstorm-designing' }],
  },
  {
    id: 'brainstorm-designing',
    skill: 'brainstorming-designing',
    transitions: [{ to: 'clear-bs3' }],
  },
  {
    id: 'clear-bs3',
    skill: 'collab-clear',
    transitions: [{ to: 'brainstorm-validating' }],
  },
  {
    id: 'brainstorm-validating',
    skill: 'brainstorming-validating',
    transitions: [{ to: 'item-type-router' }],
  },

  // ========== Item type router (routing node) ==========
  {
    id: 'item-type-router',
    skill: null,
    transitions: [
      { to: 'clear-pre-rough', condition: { type: 'item_type', value: 'code' } },
      { to: 'task-planning', condition: { type: 'item_type', value: 'task' } },
    ],
  },

  // ========== Rough-draft states ==========
  {
    id: 'clear-pre-rough',
    skill: 'collab-clear',
    transitions: [{ to: 'rough-draft-interface' }],
  },
  {
    id: 'rough-draft-interface',
    skill: 'rough-draft-interface',
    transitions: [{ to: 'clear-rd1' }],
  },
  {
    id: 'clear-rd1',
    skill: 'collab-clear',
    transitions: [{ to: 'rough-draft-pseudocode' }],
  },
  {
    id: 'rough-draft-pseudocode',
    skill: 'rough-draft-pseudocode',
    transitions: [{ to: 'clear-rd2' }],
  },
  {
    id: 'clear-rd2',
    skill: 'collab-clear',
    transitions: [{ to: 'rough-draft-skeleton' }],
  },
  {
    id: 'rough-draft-skeleton',
    skill: 'rough-draft-skeleton',
    transitions: [{ to: 'clear-rd3' }],
  },
  {
    id: 'clear-rd3',
    skill: 'collab-clear',
    transitions: [{ to: 'build-task-graph' }],
  },
  {
    id: 'build-task-graph',
    skill: 'build-task-graph',
    transitions: [{ to: 'clear-rd4' }],
  },
  {
    id: 'clear-rd4',
    skill: 'collab-clear',
    transitions: [{ to: 'rough-draft-handoff' }],
  },
  {
    id: 'rough-draft-handoff',
    skill: 'rough-draft-handoff',
    transitions: [{ to: 'clear-post-item' }],
  },

  // ========== Other paths ==========
  {
    id: 'task-planning',
    skill: 'task-planning',
    transitions: [{ to: 'clear-post-item' }],
  },
  {
    id: 'systematic-debugging',
    skill: 'systematic-debugging',
    transitions: [{ to: 'clear-post-item' }],
  },

  // ========== Post-item clear and loop back ==========
  {
    id: 'clear-post-item',
    skill: 'collab-clear',
    transitions: [{ to: 'work-item-router' }],
  },

  // ========== Ready to implement (all items documented) ==========
  {
    id: 'ready-to-implement',
    skill: 'ready-to-implement',
    transitions: [{ to: 'clear-pre-execute' }],
  },

  // ========== Execution states ==========
  {
    id: 'clear-pre-execute',
    skill: 'collab-clear',
    transitions: [{ to: 'batch-router' }],
  },
  {
    id: 'batch-router',
    skill: null,
    transitions: [
      { to: 'execute-batch', condition: { type: 'batches_remaining' } },
      { to: 'workflow-complete', condition: { type: 'no_batches_remaining' } },
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
    transitions: [{ to: 'clear-post-batch' }],
  },
  {
    id: 'clear-post-batch',
    skill: 'collab-clear',
    transitions: [{ to: 'batch-router' }],
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
 * Valid transitions for each ItemStatus
 */
const VALID_STATUS_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  'pending': ['brainstormed'],
  'brainstormed': ['interface'],
  'interface': ['pseudocode'],
  'pseudocode': ['skeleton'],
  'skeleton': ['complete'],
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
 * Converts 'documented' status to 'brainstormed' for backwards compatibility.
 * Returns a new array (non-mutating).
 * This handles sessions that were created before the status type change.
 */
export function migrateWorkItems(items: WorkItem[]): WorkItem[] {
  return items.map((item) => {
    // Type assertion needed because item.status could be 'documented' from old data
    const currentStatus = item.status as string;

    if (currentStatus === 'documented') {
      return {
        ...item,
        status: 'brainstormed',
      };
    }

    // Return item unchanged if status is already in new format
    return item;
  });
}

/**
 * Session state interface for per-item pipeline routing
 * Re-export from transitions for convenience
 */
export type SessionState = TransitionSessionState;

/**
 * Get the next state based on current state and work item status.
 * Implements per-item pipeline instead of per-phase batching.
 *
 * Coordinates the flow of items through the full pipeline:
 * 1. Each item goes: brainstorm-validating → rough-draft-interface → rough-draft-pseudocode → rough-draft-skeleton → build-task-graph
 * 2. Item status updates: pending → brainstormed → interface → pseudocode → skeleton → complete
 * 3. When item completes, moves to next pending item or workflow completion
 *
 * @param currentState - Current state ID
 * @param sessionState - Current session state with work items
 * @returns Next state ID or null if no valid transition
 */
export function getNextState(
  currentState: string,
  sessionState: SessionState
): string | null {
  // Use the per-item pipeline routing logic from transitions
  return getNextStateForPerItemPipeline(currentState as StateId, sessionState);
}
