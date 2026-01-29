/**
 * Type definitions for task status management in the MCP workflow.
 * These interfaces define the parameters and responses for MCP tools that
 * handle real-time task status updates and task graph visualization.
 */

import type { TaskBatch } from './types.js';

/**
 * Parameters for the `update_task_status` MCP tool.
 * Used to update a task's status and trigger diagram regeneration.
 */
export interface UpdateTaskStatusParams {
  /** Absolute path to the project directory */
  project: string;

  /** Session name for the collab session */
  session: string;

  /** Unique identifier of the task to update */
  taskId: string;

  /** New status for the task */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

/**
 * Parameters for the `get_task_graph` MCP tool.
 * Used to retrieve the current task execution graph state without modifications.
 */
export interface GetTaskGraphParams {
  /** Absolute path to the project directory */
  project: string;

  /** Session name for the collab session */
  session: string;
}

/**
 * Response from both the `update_task_status` and `get_task_graph` MCP tools.
 * Contains the current state of the task execution graph including the Mermaid diagram
 * and arrays of completed and pending tasks.
 */
export interface TaskGraphResponse {
  /** Whether the operation was successful (optional, defaults to true) */
  success?: boolean;

  /** Mermaid diagram syntax representing the current task execution graph */
  diagram: string;

  /** Array of task batches with current status information */
  batches: TaskBatch[];

  /** Array of IDs of tasks that have been completed */
  completedTasks: string[];

  /** Array of IDs of tasks that are pending or in progress */
  pendingTasks: string[];
}

/**
 * Payload for the `task_graph_updated` WebSocket broadcast message.
 * Sent when `update_task_status` completes, allowing connected clients to
 * update their UI in real-time.
 */
export interface TaskGraphUpdatedPayload {
  /** Mermaid diagram syntax representing the updated task execution graph */
  diagram: string;

  /** Array of task batches with current status information */
  batches: TaskBatch[];

  /** Array of IDs of tasks that have been completed */
  completedTasks: string[];

  /** Array of IDs of tasks that are pending or in progress */
  pendingTasks: string[];

  /** ID of the task that was just updated */
  updatedTaskId: string;

  /** The new status of the updated task */
  updatedStatus: string;
}
