/**
 * SessionStateUpdated Message Type Specification
 *
 * This test file specifies the expected behavior of the session_state_updated
 * message type that must be added to the WSMessage union in handler.ts.
 *
 * These tests will guide the implementation of the message type definition.
 */

import { test, expect, describe, beforeEach, vi } from 'vitest';
import { WebSocketHandler, type WSMessage } from '../handler';
import type { ServerWebSocket } from 'bun';

describe('SessionStateUpdated Message Type - Implementation Spec', () => {
  let handler: WebSocketHandler;
  let mockWs: ServerWebSocket<{ subscriptions: Set<string> }>;

  beforeEach(() => {
    handler = new WebSocketHandler();
    mockWs = {
      data: { subscriptions: new Set(['session:state']) },
      send: vi.fn(),
    } as any;
    handler.handleConnection(mockWs);
  });

  describe('Message Type Definition', () => {
    test('session_state_updated message must have type discriminator', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
      };

      expect(message.type).toBe('session_state_updated');
    });

    test('session_state_updated must include lastActivity field (required)', () => {
      const timestamp = new Date().toISOString();
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: timestamp,
      };

      const state = message as any;
      expect(state.lastActivity).toBeDefined();
      expect(state.lastActivity).toBe(timestamp);
    });
  });

  describe('Optional Fields', () => {
    test('session_state_updated should support optional completedTasks array', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        completedTasks: ['task_1', 'task_2'],
      };

      const state = message as any;
      expect(state.completedTasks).toEqual(['task_1', 'task_2']);
    });

    test('session_state_updated should support optional pendingTasks array', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        pendingTasks: ['task_3', 'task_4'],
      };

      const state = message as any;
      expect(state.pendingTasks).toEqual(['task_3', 'task_4']);
    });
  });

  describe('JSON Serialization', () => {
    test('session_state_updated message must be JSON serializable', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: '2026-01-26T10:30:00.000Z',
      };

      const json = JSON.stringify(message);
      expect(typeof json).toBe('string');
      expect(json).toContain('session_state_updated');
    });

    test('session_state_updated message must be JSON deserializable', () => {
      const original: WSMessage = {
        type: 'session_state_updated',
        lastActivity: '2026-01-26T14:00:00.000Z',
        completedTasks: ['t1'],
        pendingTasks: ['t2', 't3'],
      };

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json) as WSMessage;

      expect(parsed.type).toBe('session_state_updated');
      expect((parsed as any).completedTasks).toEqual(['t1']);
    });
  });

  describe('Type Guard Compatibility', () => {
    test('session_state_updated should work with type narrowing', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
      };

      // Type guard pattern should work
      if (message.type === 'session_state_updated') {
        const state = message as any;
        expect(state.lastActivity).toBeDefined();
      } else {
        throw new Error('Type guard failed');
      }
    });

    test('session_state_updated should be distinguishable from other message types', () => {
      const messages: WSMessage[] = [
        {
          type: 'session_state_updated',
          lastActivity: new Date().toISOString(),
        },
        {
          type: 'notification',
          data: {
            id: 'notif_1',
            type: 'info',
            title: 'Test',
            duration: 3000,
            timestamp: Date.now(),
          },
        },
        {
          type: 'diagram_updated',
          id: 'diag_1',
          content: 'test',
          lastModified: Date.now(),
        },
      ];

      const sessionStateMessages = messages.filter((msg) => msg.type === 'session_state_updated');
      expect(sessionStateMessages).toHaveLength(1);
      expect(sessionStateMessages[0].type).toBe('session_state_updated');
    });
  });

  describe('Broadcasting session_state_updated', () => {
    test('session_state_updated message should be broadcastable via WebSocketHandler', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
      };

      // Should not throw
      expect(() => {
        handler.broadcast(message);
      }).not.toThrow();

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse((mockWs.send as any).mock.calls[0][0]);
      expect(sentData.type).toBe('session_state_updated');
    });

    test('session_state_updated with all fields should broadcast correctly', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: '2026-01-26T15:00:00Z',
        completedTasks: ['task_1', 'task_2'],
        pendingTasks: ['task_3'],
      };

      handler.broadcast(message);

      const sentData = JSON.parse((mockWs.send as any).mock.calls[0][0]);
      expect(sentData.type).toBe('session_state_updated');
      expect(sentData.completedTasks).toEqual(['task_1', 'task_2']);
    });
  });

  describe('Edge Cases', () => {
    test('session_state_updated with empty arrays should serialize correctly', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        completedTasks: [],
        pendingTasks: [],
      };

      const json = JSON.stringify(message);
      const parsed = JSON.parse(json) as WSMessage;

      expect((parsed as any).completedTasks).toEqual([]);
      expect((parsed as any).pendingTasks).toEqual([]);
    });
  });
});
