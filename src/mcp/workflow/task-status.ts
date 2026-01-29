/**
 * Type definitions for task status management in the MCP workflow.
 * These interfaces define the parameters and responses for MCP tools that
 * handle real-time task status updates and task graph visualization.
 */

import type { TaskBatch } from './types.js';
import { getSessionState, updateSessionState } from '../tools/collab-state.js';
import { generateTaskDiagram } from './task-diagram.js';

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

// ============= Function Implementations =============

/**
 * Update a task's status and regenerate the task graph.
 *
 * This function:
 * 1. Validates params (project, session, taskId, status)
 * 2. Reads current session state
 * 3. Finds and updates task status in batches
 * 4. Recalculates completedTasks and pendingTasks arrays
 * 5. Updates batch status if all tasks are complete
 * 6. Saves updated state
 * 7. Generates new diagram
 * 8. Broadcasts update via WebSocket (if handler provided)
 * 9. Returns response with diagram and state
 */
export async function updateTaskStatus(
  params: UpdateTaskStatusParams,
  wsHandler?: { broadcast: (msg: unknown) => void }
): Promise<TaskGraphResponse> {
  // Step 1: Validate params
  if (!params.project || !params.session || !params.taskId || !params.status) {
    return {
      success: false,
      error: 'Missing required parameters',
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
  if (!validStatuses.includes(params.status)) {
    return {
      success: false,
      error: `Invalid status: ${params.status}`,
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  // Step 2: Read current session state
  let state;
  try {
    state = await getSessionState(params.project, params.session);
  } catch (error) {
    return {
      success: false,
      error: 'Session not found',
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  // Step 3: Find task in batches and update its status
  const batches = state.batches || [];
  let taskFound = false;
  let updatedBatchIndex = -1;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    for (const task of batch.tasks) {
      if (task.id === params.taskId) {
        task.status = params.status;
        taskFound = true;
        updatedBatchIndex = batchIdx;
        break;
      }
    }
    if (taskFound) break;
  }

  if (!taskFound) {
    return {
      success: false,
      error: `Task not found: ${params.taskId}`,
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  // Step 4: Recalculate completedTasks and pendingTasks arrays
  const completedTasks: string[] = [];
  const pendingTasks: string[] = [];

  for (const batch of batches) {
    for (const task of batch.tasks) {
      if (task.status === 'completed') {
        completedTasks.push(task.id);
      } else if (task.status === 'pending' || task.status === 'in_progress') {
        pendingTasks.push(task.id);
      }
    }
  }

  // Step 5: Update batch status if all tasks in batch are complete
  if (updatedBatchIndex >= 0) {
    const batch = batches[updatedBatchIndex];
    const allTasksComplete = batch.tasks.every((t) => t.status === 'completed');
    if (allTasksComplete) {
      batch.status = 'completed';
    } else if (batch.tasks.some((t) => t.status === 'in_progress')) {
      batch.status = 'in_progress';
    }
  }

  // Step 6: Save state via updateSessionState
  await updateSessionState(params.project, params.session, {
    batches,
    completedTasks,
    pendingTasks,
  });

  // Step 7: Generate diagram
  const diagram = generateTaskDiagram({ batches });

  // Step 8: Broadcast task_graph_updated via WebSocket
  if (wsHandler) {
    try {
      const payload: TaskGraphUpdatedPayload = {
        diagram,
        batches,
        completedTasks,
        pendingTasks,
        updatedTaskId: params.taskId,
        updatedStatus: params.status,
      };

      wsHandler.broadcast({
        type: 'task_graph_updated',
        project: params.project,
        session: params.session,
        payload,
      });
    } catch (error) {
      console.error('Failed to broadcast task graph update:', error);
    }
  }

  // Step 9: Return response
  return {
    success: true,
    diagram,
    batches,
    completedTasks,
    pendingTasks,
  };
}

/**
 * Get the current task graph state without modifications.
 *
 * This function:
 * 1. Validates params (project, session)
 * 2. Reads current session state
 * 3. Generates diagram from current state
 * 4. Returns response with diagram and current state
 */
export async function getTaskGraph(
  params: GetTaskGraphParams
): Promise<TaskGraphResponse> {
  // Step 1: Validate params
  if (!params.project || !params.session) {
    return {
      success: false,
      error: 'Missing required parameters',
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  // Step 2: Read current session state
  let state;
  try {
    state = await getSessionState(params.project, params.session);
  } catch (error) {
    return {
      success: false,
      error: 'Session not found',
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  // Step 3: Generate diagram
  const batches = state.batches || [];
  const diagram = generateTaskDiagram({ batches });

  // Step 4: Return response with current state
  return {
    success: true,
    diagram,
    batches,
    completedTasks: state.completedTasks || [],
    pendingTasks: state.pendingTasks || [],
  };
}
