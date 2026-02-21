/**
 * Collab State Broadcast Tests (TDD - RED Phase)
 *
 * These tests specify that updateSessionState should broadcast
 * a session_state_updated WebSocket message after updating state.
 *
 * Tests will guide implementation of broadcast functionality.
 */

import { test, expect, describe, beforeEach, vi, afterEach } from 'vitest';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { WebSocketHandler } from '../../websocket/handler';
import { updateSessionState, type StateUpdateParams, type CollabState } from '../collab-state';

describe('updateSessionState - Broadcast Functionality', () => {
  let testProject: string;
  let testSession: string;
  let mockWsHandler: WebSocketHandler;

  beforeEach(async () => {
    testProject = join(tmpdir(), `test-project-${Date.now()}`);
    testSession = 'test-session';

    // Create test session directory
    const sessionDir = join(testProject, '.collab', 'sessions', testSession);
    await mkdir(sessionDir, { recursive: true });

    // Mock WebSocketHandler
    mockWsHandler = {
      broadcast: vi.fn(),
    } as any;
  });

  afterEach(async () => {
    // Cleanup would happen here (simplified for this example)
  });

  describe('RED - Broadcast After State Update', () => {
    test('should broadcast session_state_updated message via WebSocket', async () => {
      const updates: StateUpdateParams = {
        currentItem: 1,
      };

      // This test expects the function to accept wsHandler
      // and broadcast after updating state
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      expect(mockWsHandler.broadcast).toHaveBeenCalledTimes(1);
      expect(mockWsHandler.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session_state_updated',
        })
      );
    });

    test('should include lastActivity in broadcast message', async () => {
      const updates: StateUpdateParams = {
        currentItem: 1,
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.lastActivity).toBeDefined();
      expect(typeof broadcastCall.lastActivity).toBe('string');
    });

    test('should include currentItem in broadcast message', async () => {
      const updates: StateUpdateParams = {
        currentItem: 3,
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.currentItem).toBe(3);
    });

    test('should include completedTasks in broadcast when provided', async () => {
      const updates: StateUpdateParams = {
        completedTasks: ['task_1', 'task_2'],
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.completedTasks).toEqual(['task_1', 'task_2']);
    });

    test('should include pendingTasks in broadcast when provided', async () => {
      const updates: StateUpdateParams = {
        pendingTasks: ['task_3', 'task_4'],
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.pendingTasks).toEqual(['task_3', 'task_4']);
    });

    test('should include totalItems in broadcast when provided', async () => {
      const updates: StateUpdateParams = {
        totalItems: 5,
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.totalItems).toBe(5);
    });

    test('should include documentedItems in broadcast when provided', async () => {
      const updates: StateUpdateParams = {
        documentedItems: 3,
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.documentedItems).toBe(3);
    });

    test('should broadcast after state is written to file', async () => {
      const updates: StateUpdateParams = {
        currentItem: 5,
      };

      const broadcastSpy = vi.fn();
      const mockHandler = {
        broadcast: broadcastSpy,
      } as any;

      await updateSessionState(testProject, testSession, updates, mockHandler);

      // Broadcast should be called
      expect(broadcastSpy).toHaveBeenCalled();

      // State file should exist and be readable
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await (await import('fs/promises')).readFile(stateFile, 'utf-8');
      const state = JSON.parse(content);
      expect(state.currentItem).toBe(5);
    });

    test('should broadcast all updated fields together', async () => {
      const updates: StateUpdateParams = {
        currentItem: 2,
        completedTasks: ['task_1'],
        pendingTasks: ['task_2', 'task_3'],
        totalItems: 5,
        documentedItems: 4,
      };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.type).toBe('session_state_updated');
      expect(broadcastCall.currentItem).toBe(2);
      expect(broadcastCall.completedTasks).toEqual(['task_1']);
      expect(broadcastCall.pendingTasks).toEqual(['task_2', 'task_3']);
      expect(broadcastCall.totalItems).toBe(5);
      expect(broadcastCall.documentedItems).toBe(4);
    });
  });

  describe('Error Handling', () => {
    test('should not throw if broadcast fails', async () => {
      const failingHandler = {
        broadcast: vi.fn(() => {
          throw new Error('Broadcast failed');
        }),
      } as any;

      const updates: StateUpdateParams = {
        currentItem: 1,
      };

      // Should not throw even if broadcast fails
      await expect(
        updateSessionState(testProject, testSession, updates, failingHandler)
      ).resolves.toBeDefined();

      // State should still be updated
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await (await import('fs/promises')).readFile(stateFile, 'utf-8');
      const state = JSON.parse(content);
      expect(state.currentItem).toBe(1);
    });

    test('should catch and log broadcast errors without breaking state update', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failingHandler = {
        broadcast: vi.fn(() => {
          throw new Error('Network error');
        }),
      } as any;

      const updates: StateUpdateParams = {
        currentItem: 2,
      };

      await updateSessionState(testProject, testSession, updates, failingHandler);

      // State file should be written successfully
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await (await import('fs/promises')).readFile(stateFile, 'utf-8');
      const state = JSON.parse(content);
      expect(state.currentItem).toBe(2);

      consoleSpy.mockRestore();
    });
  });

  describe('Broadcast Content Requirements', () => {
    test('broadcast message must have session_state_updated type discriminator', async () => {
      const updates: StateUpdateParams = { currentItem: 1 };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.type).toBe('session_state_updated');
    });

    test('broadcast should use lastActivity from updated state (not from input)', async () => {
      const beforeTime = new Date();
      await new Promise(resolve => setTimeout(resolve, 10));

      const updates: StateUpdateParams = { currentItem: 1 };
      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      const lastActivity = new Date(broadcastCall.lastActivity);

      expect(lastActivity.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });

    test('broadcast should include currentItem as null when not updated', async () => {
      const updates: StateUpdateParams = { totalItems: 3 };

      await updateSessionState(testProject, testSession, updates, mockWsHandler);

      const broadcastCall = (mockWsHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.currentItem).toBeNull();
    });
  });

  describe('Optional wsHandler Parameter', () => {
    test('should work when wsHandler is not provided (backward compatibility)', async () => {
      const updates: StateUpdateParams = {
        currentItem: 1,
      };

      // Call without wsHandler - should not throw
      await expect(
        updateSessionState(testProject, testSession, updates)
      ).resolves.toBeDefined();

      // State should still be updated
      const stateFile = join(testProject, '.collab', 'sessions', testSession, 'collab-state.json');
      const content = await (await import('fs/promises')).readFile(stateFile, 'utf-8');
      const state = JSON.parse(content);
      expect(state.currentItem).toBe(1);
    });

    test('should only broadcast if wsHandler is provided', async () => {
      const updates: StateUpdateParams = {
        currentItem: 1,
      };

      // First call without wsHandler
      await updateSessionState(testProject, testSession, updates);
      expect(mockWsHandler.broadcast).not.toHaveBeenCalled();

      // Second call with wsHandler
      await updateSessionState(testProject, testSession, updates, mockWsHandler);
      expect(mockWsHandler.broadcast).toHaveBeenCalled();
    });
  });
});
