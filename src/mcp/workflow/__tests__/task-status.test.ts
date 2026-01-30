/**
 * Unit tests for task-status implementation.
 * Tests both type definitions and function implementations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  UpdateTaskStatusParams,
  GetTaskGraphParams,
  TaskGraphResponse,
  TaskGraphUpdatedPayload,
} from '../task-status.js';
import { updateTaskStatus, getTaskGraph } from '../task-status.js';
import * as collabState from '../../tools/collab-state.js';
import * as taskDiagram from '../task-diagram.js';
import type { TaskBatch } from '../types.js';

describe('task-status types', () => {
  describe('UpdateTaskStatusParams', () => {
    it('should allow all valid status values', () => {
      const validParams: UpdateTaskStatusParams[] = [
        {
          project: '/project',
          session: 'session-name',
          taskId: 'task-1',
          status: 'pending',
        },
        {
          project: '/project',
          session: 'session-name',
          taskId: 'task-1',
          status: 'in_progress',
        },
        {
          project: '/project',
          session: 'session-name',
          taskId: 'task-1',
          status: 'completed',
        },
        {
          project: '/project',
          session: 'session-name',
          taskId: 'task-1',
          status: 'failed',
        },
      ];

      expect(validParams).toHaveLength(4);
      validParams.forEach((params) => {
        expect(params.project).toBeDefined();
        expect(params.session).toBeDefined();
        expect(params.taskId).toBeDefined();
        expect(params.status).toBeDefined();
      });
    });

    it('should require all fields', () => {
      const params: UpdateTaskStatusParams = {
        project: '/Users/test/project',
        session: 'bright-open-river',
        taskId: 'task-42',
        status: 'completed',
      };

      expect(params).toHaveProperty('project');
      expect(params).toHaveProperty('session');
      expect(params).toHaveProperty('taskId');
      expect(params).toHaveProperty('status');
    });
  });

  describe('GetTaskGraphParams', () => {
    it('should require project and session', () => {
      const params: GetTaskGraphParams = {
        project: '/Users/test/project',
        session: 'bright-open-river',
      };

      expect(params).toHaveProperty('project');
      expect(params).toHaveProperty('session');
      expect(Object.keys(params)).toHaveLength(2);
    });
  });

  describe('TaskGraphResponse', () => {
    it('should have all required fields', () => {
      const response: TaskGraphResponse = {
        diagram: 'graph TD\n  A --> B',
        batches: [],
        completedTasks: [],
        pendingTasks: [],
      };

      expect(response.diagram).toBeDefined();
      expect(response.batches).toBeDefined();
      expect(response.completedTasks).toBeDefined();
      expect(response.pendingTasks).toBeDefined();
    });

    it('should allow optional success field', () => {
      const responseWithSuccess: TaskGraphResponse = {
        success: true,
        diagram: 'graph TD',
        batches: [],
        completedTasks: [],
        pendingTasks: [],
      };

      expect(responseWithSuccess.success).toBe(true);
    });

    it('should support non-empty arrays', () => {
      const response: TaskGraphResponse = {
        diagram: 'graph TD\n  Task1 --> Task2',
        batches: [
          {
            id: 'batch-1',
            tasks: [
              {
                id: 'task-1',
                status: 'completed',
                dependsOn: [],
              },
              {
                id: 'task-2',
                status: 'in_progress',
                dependsOn: ['task-1'],
              },
            ],
            status: 'in_progress',
          },
        ],
        completedTasks: ['task-1'],
        pendingTasks: ['task-2', 'task-3'],
      };

      expect(response.batches).toHaveLength(1);
      expect(response.completedTasks).toHaveLength(1);
      expect(response.pendingTasks).toHaveLength(2);
    });
  });

  describe('TaskGraphUpdatedPayload', () => {
    it('should have all required fields', () => {
      const payload: TaskGraphUpdatedPayload = {
        diagram: 'graph TD\n  A --> B',
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        updatedTaskId: 'task-42',
        updatedStatus: 'completed',
      };

      expect(payload.diagram).toBeDefined();
      expect(payload.batches).toBeDefined();
      expect(payload.completedTasks).toBeDefined();
      expect(payload.pendingTasks).toBeDefined();
      expect(payload.updatedTaskId).toBeDefined();
      expect(payload.updatedStatus).toBeDefined();
    });

    it('should correctly represent a task status update event', () => {
      const payload: TaskGraphUpdatedPayload = {
        diagram: 'graph TD\n  Task1["Task1: completed"] --> Task2',
        batches: [
          {
            id: 'batch-1',
            tasks: [
              {
                id: 'task-1',
                status: 'completed',
                dependsOn: [],
              },
            ],
            status: 'completed',
          },
        ],
        completedTasks: ['task-1'],
        pendingTasks: ['task-2'],
        updatedTaskId: 'task-1',
        updatedStatus: 'completed',
      };

      expect(payload.updatedTaskId).toBe('task-1');
      expect(payload.updatedStatus).toBe('completed');
      expect(payload.completedTasks).toContain('task-1');
      expect(payload.pendingTasks).not.toContain('task-1');
    });
  });

  describe('Type compatibility', () => {
    it('should allow UpdateTaskStatusParams to be converted to GetTaskGraphParams', () => {
      const updateParams: UpdateTaskStatusParams = {
        project: '/project',
        session: 'session',
        taskId: 'task-1',
        status: 'completed',
      };

      const graphParams: GetTaskGraphParams = {
        project: updateParams.project,
        session: updateParams.session,
      };

      expect(graphParams.project).toBe(updateParams.project);
      expect(graphParams.session).toBe(updateParams.session);
    });

    it('should allow TaskGraphResponse to be used as TaskGraphUpdatedPayload base', () => {
      const response: TaskGraphResponse = {
        diagram: 'diagram',
        batches: [],
        completedTasks: [],
        pendingTasks: [],
      };

      const payload: TaskGraphUpdatedPayload = {
        ...response,
        updatedTaskId: 'task-1',
        updatedStatus: 'completed',
      };

      expect(payload.diagram).toBe(response.diagram);
      expect(payload.batches).toBe(response.batches);
    });
  });
});

// ============= Function Implementation Tests =============

describe('updateTaskStatus function', () => {
  const mockProject = '/test/project';
  const mockSession = 'test-session';
  const mockBatches: TaskBatch[] = [
    {
      id: 'batch-1',
      status: 'pending',
      tasks: [
        {
          id: 'task-1',
          status: 'pending',
          dependsOn: [],
        },
        {
          id: 'task-2',
          status: 'pending',
          dependsOn: ['task-1'],
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate required parameters', async () => {
    const invalidParams = {
      project: '',
      session: mockSession,
      taskId: 'task-1',
      status: 'completed' as const,
    };

    const response = await updateTaskStatus(invalidParams);
    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });

  it('should reject invalid status values', async () => {
    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches: mockBatches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'invalid' as any,
    };

    const response = await updateTaskStatus(params);
    expect(response.success).toBe(false);
    expect(response.error).toContain('Invalid status');
  });

  it('should return error when session not found', async () => {
    vi.spyOn(collabState, 'getSessionState').mockRejectedValue(
      new Error('Session not found')
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: 'nonexistent',
      taskId: 'task-1',
      status: 'completed',
    };

    const response = await updateTaskStatus(params);
    expect(response.success).toBe(false);
    expect(response.error).toContain('Session not found');
  });

  it('should return error when task not found', async () => {
    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches: mockBatches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'nonexistent-task',
      status: 'completed',
    };

    const response = await updateTaskStatus(params);
    expect(response.success).toBe(false);
    expect(response.error).toContain('Task not found');
  });

  it('should update task status from pending to in_progress', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'pending',
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            dependsOn: [],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD\n  task_1["task-1: in_progress"]'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'in_progress',
    };

    const response = await updateTaskStatus(params);

    expect(response.success).toBe(true);
    expect(response.pendingTasks).toContain('task-1');
    expect(response.completedTasks).not.toContain('task-1');
  });

  it('should update task status from in_progress to completed', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'in_progress',
        tasks: [
          {
            id: 'task-1',
            status: 'in_progress',
            dependsOn: [],
          },
          {
            id: 'task-2',
            status: 'pending',
            dependsOn: ['task-1'],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD\n  task_1["task-1: completed"]'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'completed',
    };

    const response = await updateTaskStatus(params);

    expect(response.success).toBe(true);
    expect(response.completedTasks).toContain('task-1');
    expect(response.pendingTasks).not.toContain('task-1');
  });

  it('should detect batch completion when all tasks are completed', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'in_progress',
        tasks: [
          {
            id: 'task-1',
            status: 'completed',
            dependsOn: [],
          },
          {
            id: 'task-2',
            status: 'in_progress',
            dependsOn: ['task-1'],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-2',
      status: 'completed',
    };

    const response = await updateTaskStatus(params);

    expect(response.success).toBe(true);
    expect(response.batches[0].status).toBe('completed');
  });

  it('should recalculate completedTasks and pendingTasks arrays', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'in_progress',
        tasks: [
          {
            id: 'task-1',
            status: 'completed',
            dependsOn: [],
          },
          {
            id: 'task-2',
            status: 'in_progress',
            dependsOn: ['task-1'],
          },
          {
            id: 'task-3',
            status: 'pending',
            dependsOn: ['task-2'],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-3',
      status: 'in_progress',
    };

    const response = await updateTaskStatus(params);

    expect(response.success).toBe(true);
    expect(response.completedTasks).toEqual(['task-1']);
    expect(response.pendingTasks).toContain('task-2');
    expect(response.pendingTasks).toContain('task-3');
  });

  it('should call updateSessionState with new state', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'pending',
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            dependsOn: [],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    const updateSpy = vi.spyOn(collabState, 'updateSessionState')
      .mockResolvedValue({ success: true });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'in_progress',
    };

    await updateTaskStatus(params);

    expect(updateSpy).toHaveBeenCalledWith(
      mockProject,
      mockSession,
      expect.objectContaining({
        batches: expect.any(Array),
        completedTasks: expect.any(Array),
        pendingTasks: expect.any(Array),
      })
    );
  });

  it('should broadcast task_graph_updated via WebSocket handler', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'pending',
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            dependsOn: [],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD'
    );

    const mockBroadcast = vi.fn();
    const wsHandler = { broadcast: mockBroadcast };

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'in_progress',
    };

    await updateTaskStatus(params, wsHandler);

    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task_graph_updated',
        project: mockProject,
        session: mockSession,
        payload: expect.objectContaining({
          updatedTaskId: 'task-1',
          updatedStatus: 'in_progress',
          diagram: expect.any(String),
          batches: expect.any(Array),
          completedTasks: expect.any(Array),
          pendingTasks: expect.any(Array),
        }),
      })
    );
  });

  it('should return minimal response when minimal flag is true', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'pending',
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            dependsOn: [],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD\n  task_1["task-1: in_progress"]'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'in_progress',
      minimal: true,
    };

    const response = await updateTaskStatus(params);

    expect(response.success).toBe(true);
    // Minimal response should NOT include diagram, batches, completedTasks, pendingTasks
    expect(response.diagram).toBeUndefined();
    expect(response.batches).toBeUndefined();
    expect(response.completedTasks).toBeUndefined();
    expect(response.pendingTasks).toBeUndefined();
  });

  it('should return full response when minimal flag is false', async () => {
    const batches: TaskBatch[] = [
      {
        id: 'batch-1',
        status: 'pending',
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            dependsOn: [],
          },
        ],
      },
    ];

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(collabState, 'updateSessionState').mockResolvedValue({
      success: true,
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD\n  task_1["task-1: in_progress"]'
    );

    const params: UpdateTaskStatusParams = {
      project: mockProject,
      session: mockSession,
      taskId: 'task-1',
      status: 'in_progress',
      minimal: false,
    };

    const response = await updateTaskStatus(params);

    expect(response.success).toBe(true);
    expect(response.diagram).toBeDefined();
    expect(response.batches).toBeDefined();
    expect(response.completedTasks).toBeDefined();
    expect(response.pendingTasks).toBeDefined();
  });
});

describe('getTaskGraph function', () => {
  const mockProject = '/test/project';
  const mockSession = 'test-session';
  const mockBatches: TaskBatch[] = [
    {
      id: 'batch-1',
      status: 'pending',
      tasks: [
        {
          id: 'task-1',
          status: 'pending',
          dependsOn: [],
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate required parameters', async () => {
    const invalidParams = {
      project: '',
      session: mockSession,
    };

    const response = await getTaskGraph(invalidParams as any);
    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });

  it('should return error when session not found', async () => {
    vi.spyOn(collabState, 'getSessionState').mockRejectedValue(
      new Error('Session not found')
    );

    const params: GetTaskGraphParams = {
      project: mockProject,
      session: 'nonexistent',
    };

    const response = await getTaskGraph(params);
    expect(response.success).toBe(false);
    expect(response.error).toContain('Session not found');
  });

  it('should return current state without modifications', async () => {
    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches: mockBatches,
      completedTasks: [],
      pendingTasks: ['task-1'],
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD'
    );

    const params: GetTaskGraphParams = {
      project: mockProject,
      session: mockSession,
    };

    const response = await getTaskGraph(params);

    expect(response.success).toBe(true);
    expect(response.batches).toEqual(mockBatches);
    expect(response.pendingTasks).toEqual(['task-1']);
    expect(response.completedTasks).toEqual([]);
  });

  it('should generate diagram from current state', async () => {
    const mockDiagram = 'graph TD\n  A --> B';

    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches: mockBatches,
      completedTasks: [],
      pendingTasks: ['task-1'],
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    const diagramSpy = vi.spyOn(taskDiagram, 'generateTaskDiagram')
      .mockReturnValue(mockDiagram);

    const params: GetTaskGraphParams = {
      project: mockProject,
      session: mockSession,
    };

    const response = await getTaskGraph(params);

    expect(diagramSpy).toHaveBeenCalledWith(
      expect.objectContaining({ batches: mockBatches })
    );
    expect(response.diagram).toBe(mockDiagram);
  });

  it('should handle empty batches', async () => {
    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches: [],
      completedTasks: [],
      pendingTasks: [],
      lastActivity: new Date().toISOString(),
      currentItem: null
    });

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD\n    empty["No tasks defined"]'
    );

    const params: GetTaskGraphParams = {
      project: mockProject,
      session: mockSession,
    };

    const response = await getTaskGraph(params);

    expect(response.success).toBe(true);
    expect(response.batches).toEqual([]);
    expect(response.completedTasks).toEqual([]);
    expect(response.pendingTasks).toEqual([]);
  });

  it('should provide default empty arrays for missing state fields', async () => {
    vi.spyOn(collabState, 'getSessionState').mockResolvedValue({
      batches: mockBatches,
      lastActivity: new Date().toISOString(),
      currentItem: null
    } as any);

    vi.spyOn(taskDiagram, 'generateTaskDiagram').mockReturnValue(
      'graph TD'
    );

    const params: GetTaskGraphParams = {
      project: mockProject,
      session: mockSession,
    };

    const response = await getTaskGraph(params);

    expect(response.success).toBe(true);
    expect(response.completedTasks).toEqual([]);
    expect(response.pendingTasks).toEqual([]);
  });
});
