/**
 * Type definitions for vibe task graph execution.
 */

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
