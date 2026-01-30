/**
 * Type definitions for task status management in the MCP workflow.
 * These interfaces define the parameters and responses for MCP tools that
 * handle real-time task status updates and task graph visualization.
 */

import type { TaskBatch } from './types.js';
import { getSessionState, updateSessionState } from '../tools/collab-state.js';
import { generateTaskDiagram } from './task-diagram.js';

/** Single task update for batch operations */
export interface TaskUpdate {
  /** Unique identifier of the task to update */
  taskId: string;

  /** New status for the task */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

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

  /** If true, return minimal response (just success) to reduce context size */
  minimal?: boolean;
}

/**
 * Parameters for the `update_tasks_status` MCP tool (batch update).
 * Used to update multiple tasks' statuses in a single call.
 */
export interface UpdateTasksStatusParams {
  /** Absolute path to the project directory */
  project: string;

  /** Session name for the collab session */
  session: string;

  /** Array of task updates to apply */
  updates: TaskUpdate[];

  /** If true, return minimal response (just success) to reduce context size */
  minimal?: boolean;
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
 * Sent when `update_task_status` or `update_tasks_status` completes,
 * allowing connected clients to update their UI in real-time.
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

  /** ID of the task that was just updated (single update) */
  updatedTaskId?: string;

  /** The new status of the updated task (single update) */
  updatedStatus?: string;

  /** Array of task updates applied (batch update) */
  updatedTasks?: TaskUpdate[];
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

  // Step 9: Return response (minimal if requested)
  if (params.minimal) {
    return {
      success: true,
    } as TaskGraphResponse;
  }

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

/**
 * Update multiple tasks' statuses in a single call.
 *
 * This function efficiently updates multiple tasks by:
 * 1. Validating all params upfront
 * 2. Reading session state once
 * 3. Updating all tasks in a single pass
 * 4. Recalculating arrays once
 * 5. Saving state once
 * 6. Generating diagram once
 * 7. Broadcasting once with all updates
 */
export async function updateTasksStatus(
  params: UpdateTasksStatusParams,
  wsHandler?: { broadcast: (msg: unknown) => void }
): Promise<TaskGraphResponse> {
  // Step 1: Validate params
  if (!params.project || !params.session || !params.updates || params.updates.length === 0) {
    return {
      success: false,
      error: 'Missing required parameters or empty updates array',
      diagram: '',
      batches: [],
      completedTasks: [],
      pendingTasks: [],
    } as unknown as TaskGraphResponse;
  }

  const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
  for (const update of params.updates) {
    if (!update.taskId || !update.status) {
      return {
        success: false,
        error: 'Each update must have taskId and status',
        diagram: '',
        batches: [],
        completedTasks: [],
        pendingTasks: [],
      } as unknown as TaskGraphResponse;
    }
    if (!validStatuses.includes(update.status)) {
      return {
        success: false,
        error: `Invalid status: ${update.status}`,
        diagram: '',
        batches: [],
        completedTasks: [],
        pendingTasks: [],
      } as unknown as TaskGraphResponse;
    }
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

  // Step 3: Create a map for quick lookup of updates
  const updateMap = new Map(params.updates.map((u) => [u.taskId, u.status]));
  const batches = state.batches || [];
  const appliedUpdates: TaskUpdate[] = [];
  const notFoundTasks: string[] = [];

  // Step 4: Update all tasks in a single pass
  for (const batch of batches) {
    for (const task of batch.tasks) {
      const newStatus = updateMap.get(task.id);
      if (newStatus) {
        task.status = newStatus;
        appliedUpdates.push({ taskId: task.id, status: newStatus });
        updateMap.delete(task.id); // Remove from map to track not-found tasks
      }
    }
  }

  // Track tasks that weren't found
  notFoundTasks.push(...Array.from(updateMap.keys()));

  // Step 5: Recalculate completedTasks and pendingTasks arrays
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

  // Step 6: Update batch statuses
  for (const batch of batches) {
    const allTasksComplete = batch.tasks.every((t) => t.status === 'completed');
    if (allTasksComplete) {
      batch.status = 'completed';
    } else if (batch.tasks.some((t) => t.status === 'in_progress')) {
      batch.status = 'in_progress';
    }
  }

  // Step 7: Save state
  await updateSessionState(params.project, params.session, {
    batches,
    completedTasks,
    pendingTasks,
  });

  // Step 8: Generate diagram
  const diagram = generateTaskDiagram({ batches });

  // Step 9: Broadcast task_graph_updated via WebSocket
  if (wsHandler) {
    try {
      const payload: TaskGraphUpdatedPayload = {
        diagram,
        batches,
        completedTasks,
        pendingTasks,
        updatedTasks: appliedUpdates,
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

  // Step 10: Return response (minimal if requested)
  if (params.minimal) {
    const response: Record<string, unknown> = { success: true, updated: appliedUpdates.length };
    if (notFoundTasks.length > 0) {
      response.notFound = notFoundTasks;
    }
    return response as unknown as TaskGraphResponse;
  }

  const response: Record<string, unknown> = {
    success: true,
    diagram,
    batches,
    completedTasks,
    pendingTasks,
    updated: appliedUpdates.length,
  };
  if (notFoundTasks.length > 0) {
    response.notFound = notFoundTasks;
  }
  return response as unknown as TaskGraphResponse;
}
