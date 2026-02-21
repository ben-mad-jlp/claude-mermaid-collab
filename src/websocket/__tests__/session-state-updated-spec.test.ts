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
      // The session_state_updated type must be part of the WSMessage union
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      expect(message.type).toBe('session_state_updated');
    });

    test('session_state_updated must include lastActivity field (required)', () => {
      const timestamp = new Date().toISOString();
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: timestamp,
        currentItem: 1,
      };

      const state = message as any;
      expect(state.lastActivity).toBeDefined();
      expect(state.lastActivity).toBe(timestamp);
    });

    test('session_state_updated must include currentItem field (required, can be null)', () => {
      const messageWithNull: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: null,
      };

      const messageWithNumber: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 2,
      };

      expect((messageWithNull as any).currentItem).toBeNull();
      expect((messageWithNumber as any).currentItem).toBe(2);
    });
  });

  describe('Optional Fields', () => {
    test('session_state_updated should support optional completedTasks array', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
        completedTasks: ['task_1', 'task_2'],
      };

      const state = message as any;
      expect(state.completedTasks).toEqual(['task_1', 'task_2']);
    });

    test('session_state_updated should support optional pendingTasks array', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
        pendingTasks: ['task_3', 'task_4'],
      };

      const state = message as any;
      expect(state.pendingTasks).toEqual(['task_3', 'task_4']);
    });

    test('session_state_updated should support optional totalItems number', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
        totalItems: 5,
      };

      const state = message as any;
      expect(state.totalItems).toBe(5);
    });

    test('session_state_updated should support optional documentedItems number', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 2,
        documentedItems: 3,
      };

      const state = message as any;
      expect(state.documentedItems).toBe(3);
    });
  });

  describe('JSON Serialization', () => {
    test('session_state_updated message must be JSON serializable', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: '2026-01-26T10:30:00.000Z',
        currentItem: 1,
      };

      const json = JSON.stringify(message);
      expect(typeof json).toBe('string');
      expect(json).toContain('session_state_updated');
    });

    test('session_state_updated message must be JSON deserializable', () => {
      const original: WSMessage = {
        type: 'session_state_updated',
        lastActivity: '2026-01-26T14:00:00.000Z',
        currentItem: 3,
        completedTasks: ['t1'],
        pendingTasks: ['t2', 't3'],
        totalItems: 5,
        documentedItems: 4,
      };

      const json = JSON.stringify(original);
      const parsed = JSON.parse(json) as WSMessage;

      expect(parsed.type).toBe('session_state_updated');
      expect((parsed as any).currentItem).toBe(3);
      expect((parsed as any).completedTasks).toEqual(['t1']);
      expect((parsed as any).totalItems).toBe(5);
    });

    test('session_state_updated should preserve null values in JSON', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: '2026-01-26T10:00:00Z',
        currentItem: null,
      };

      const json = JSON.stringify(message);
      const parsed = JSON.parse(json);

      expect((parsed as any).currentItem).toBeNull();
    });
  });

  describe('Type Guard Compatibility', () => {
    test('session_state_updated should work with type narrowing', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
      };

      // Type guard pattern should work
      if (message.type === 'session_state_updated') {
        const state = message as any;
        expect(state.lastActivity).toBeDefined();
        expect(state.currentItem).toBeDefined();
      } else {
        throw new Error('Type guard failed');
      }
    });

    test('session_state_updated should be distinguishable from other message types', () => {
      const messages: WSMessage[] = [
        {
          type: 'session_state_updated',
  
          lastActivity: new Date().toISOString(),
          currentItem: 1,
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
        currentItem: 1,
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
        currentItem: 2,
        completedTasks: ['task_1', 'task_2'],
        pendingTasks: ['task_3'],
        totalItems: 5,
        documentedItems: 4,
      };

      handler.broadcast(message);

      const sentData = JSON.parse((mockWs.send as any).mock.calls[0][0]);
      expect(sentData.type).toBe('session_state_updated');
      expect(sentData.completedTasks).toEqual(['task_1', 'task_2']);
      expect(sentData.totalItems).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    test('session_state_updated with empty arrays should serialize correctly', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 1,
        completedTasks: [],
        pendingTasks: [],
      };

      const json = JSON.stringify(message);
      const parsed = JSON.parse(json) as WSMessage;

      expect((parsed as any).completedTasks).toEqual([]);
      expect((parsed as any).pendingTasks).toEqual([]);
    });

    test('session_state_updated with zero totalItems should be valid', () => {
      const message: WSMessage = {
        type: 'session_state_updated',
        lastActivity: new Date().toISOString(),
        currentItem: 0,
        totalItems: 0,
        documentedItems: 0,
      };

      expect((message as any).currentItem).toBe(0);
      expect((message as any).totalItems).toBe(0);
      expect((message as any).documentedItems).toBe(0);
    });

  });
});
