/**
 * Unit tests for task-status type definitions.
 * Verifies that the exported interfaces match the expected structure
 * and can be instantiated correctly.
 */

import { describe, it, expect } from 'vitest';
import type {
  UpdateTaskStatusParams,
  GetTaskGraphParams,
  TaskGraphResponse,
  TaskGraphUpdatedPayload,
} from '../task-status.js';

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
