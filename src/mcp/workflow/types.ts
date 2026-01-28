/**
 * Type definitions for the MCP workflow state machine.
 */

/** Unique identifier for each workflow state */
export type StateId =
  | 'collab-start'
  | 'gather-goals'
  | 'clear-pre-item'
  // Brainstorm phase routing
  | 'brainstorm-item-router'
  // Brainstorming states
  | 'brainstorm-exploring'
  | 'clear-bs1'
  | 'brainstorm-clarifying'
  | 'clear-bs2'
  | 'brainstorm-designing'
  | 'clear-bs3'
  | 'brainstorm-validating'
  | 'item-type-router'
  | 'clear-post-brainstorm'
  // Rough-draft phase transition
  | 'rough-draft-confirm'
  | 'clear-pre-rough-batch'
  | 'rough-draft-item-router'
  // Rough-draft states
  | 'clear-pre-rough'
  | 'rough-draft-interface'
  | 'clear-rd1'
  | 'rough-draft-pseudocode'
  | 'clear-rd2'
  | 'rough-draft-skeleton'
  | 'clear-rd3'
  | 'build-task-graph'
  | 'clear-rd4'
  | 'rough-draft-handoff'
  | 'clear-post-rough'
  // Other paths
  | 'task-planning'
  | 'systematic-debugging'
  | 'ready-to-implement'
  // Execution states
  | 'clear-pre-execute'
  | 'batch-router'
  | 'execute-batch'
  | 'log-batch-complete'
  | 'clear-post-batch'
  // Legacy (kept for backwards compatibility)
  | 'work-item-router'
  | 'clear-post-item'
  // Terminal states
  | 'workflow-complete'
  | 'cleanup'
  | 'done';

/** Condition types for transition guards */
export type TransitionCondition =
  | { type: 'item_type'; value: 'code' | 'task' | 'bugfix' }
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
  action?: 'clear' | 'none';
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
 * Each item progresses: pending → brainstormed → interface → pseudocode → skeleton → complete
 */
export type ItemStatus =
  | 'pending'      // Not started
  | 'brainstormed' // Design spec complete, ready for rough-draft
  | 'interface'    // Interface doc created
  | 'pseudocode'   // Pseudocode doc created
  | 'skeleton'     // Skeleton doc created (rough-draft complete)
  | 'complete';    // Ready for implementation

/** Work item status (deprecated, kept for backwards compatibility) */
export type WorkItemStatus = 'pending' | 'documented';

/** Work item in session state */
export interface WorkItem {
  number: number;
  title: string;
  type: WorkItemType;
  status: ItemStatus;
}
