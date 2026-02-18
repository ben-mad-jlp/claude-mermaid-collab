/**
 * Type definitions for the MCP workflow state machine.
 */

/** Session type: structured (guided workflow) or vibe (freeform) */
export type SessionType = 'structured' | 'vibe';

/** Unique identifier for each workflow state */
export type StateId =
  | 'collab-start'
  | 'gather-goals'
  // Brainstorm phase routing
  | 'brainstorm-item-router'
  // Brainstorming states
  | 'brainstorm-exploring'
  | 'brainstorm-clarifying'
  | 'brainstorm-designing'
  | 'brainstorm-validating'
  | 'item-type-router'
  // Rough-draft phase transition
  | 'rough-draft-confirm'
  | 'rough-draft-item-router'
  // Rough-draft states
  | 'rough-draft-blueprint'
  // Other paths
  | 'task-planning'
  | 'systematic-debugging'
  | 'ready-to-implement'
  // Execution states
  | 'batch-router'
  | 'execute-batch'
  | 'log-batch-complete'
  | 'bug-review'
  | 'completeness-review'
  // Legacy (kept for backwards compatibility)
  | 'work-item-router'
  // Terminal states
  | 'workflow-complete'
  | 'vibe-active'
  | 'cleanup'
  | 'done';

/** Condition types for transition guards */
export type TransitionCondition =
  | { type: 'item_type'; value: 'code' | 'task' | 'bugfix' }
  | { type: 'session_type'; value: SessionType }
  | { type: 'items_remaining' }
  | { type: 'no_items_remaining' }
  | { type: 'pending_brainstorm_items' }
  | { type: 'no_pending_brainstorm_items' }
  | { type: 'pending_rough_draft_items' }
  | { type: 'no_pending_rough_draft_items' }
  | { type: 'batches_remaining' }
  | { type: 'no_batches_remaining' }
  | { type: 'always' };

/** A transition from one state to another */
export interface Transition {
  to: StateId;
  condition?: TransitionCondition;
}

/** A state in the workflow */
export interface WorkflowState {
  id: StateId;
  skill: string | null;
  transitions: Transition[];
}

/** Input for complete_skill MCP tool */
export interface CompleteSkillInput {
  project: string;
  session: string;
  skill: string;
}

/** Output from complete_skill MCP tool */
export interface CompleteSkillOutput {
  next_skill: string | null;
  params?: {
    item_number?: number;
    batch_index?: number;
  };
  action?: 'none';
}

/** Batch definition for execution phase */
export interface TaskBatch {
  id: string;
  tasks: BatchTask[];
  status: 'pending' | 'in_progress' | 'completed';
}

/** Task within a batch */
export interface BatchTask {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependsOn: string[];
}

/** Work item type */
export type WorkItemType = 'code' | 'task' | 'bugfix';

/**
 * Unified pipeline status for work items.
 * Each item progresses: pending → brainstormed → complete
 * (The blueprint skill handles all rough-draft work in a single step)
 */
export type ItemStatus =
  | 'pending'      // Not started
  | 'brainstormed' // Design spec complete, ready for rough-draft
  | 'complete';    // Blueprint complete, ready for implementation

/** Work item status (deprecated, kept for backwards compatibility) */
export type WorkItemStatus = 'pending' | 'documented';

/** Work item in session state */
export interface WorkItem {
  number: number;
  title: string;
  type: WorkItemType;
  status: ItemStatus;
}
