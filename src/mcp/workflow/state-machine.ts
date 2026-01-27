/**
 * Workflow state machine definitions.
 * Contains all states and their transitions.
 */

import type { StateId, WorkflowState } from './types.js';

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
