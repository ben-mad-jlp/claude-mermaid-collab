import { test, expect, describe, beforeEach, vi, afterEach } from 'vitest';
import { WebSocketHandler, type WSMessage } from '../handler';
import type { ServerWebSocket } from 'bun';

describe('WebSocketHandler - Notification Broadcasting', () => {
  let handler: WebSocketHandler;
  let mockWs1: ServerWebSocket<{ subscriptions: Set<string> }>;
  let mockWs2: ServerWebSocket<{ subscriptions: Set<string> }>;
  let mockWs3: ServerWebSocket<{ subscriptions: Set<string> }>;

  beforeEach(() => {
    handler = new WebSocketHandler();

    // Create mock WebSocket connections
    mockWs1 = {
      data: { subscriptions: new Set() },
      send: vi.fn(),
    } as any;

    mockWs2 = {
      data: { subscriptions: new Set() },
      send: vi.fn(),
    } as any;

    mockWs3 = {
      data: { subscriptions: new Set() },
      send: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Notification Message Type', () => {
    test('should define notification message type with required fields', () => {
      // This test validates the type definition exists
      const notification: WSMessage = {
        type: 'notification',
        data: {
          id: 'notif_1234_abcd',
          type: 'success',
          title: 'Document updated',
          message: 'doc-123',
          duration: 4000,
          timestamp: Date.now(),
        },
      };

      expect(notification.type).toBe('notification');
      expect(notification.data.id).toBeDefined();
      expect(notification.data.type).toBe('success');
      expect(notification.data.title).toBeDefined();
      expect(notification.data.duration).toBeDefined();
      expect(notification.data.timestamp).toBeDefined();
    });

    test('should support all notification types', () => {
      const types: Array<'info' | 'success' | 'warning' | 'error'> = [
        'info',
        'success',
        'warning',
        'error',
      ];

      types.forEach((notifType) => {
        const notification: WSMessage = {
          type: 'notification',
          data: {
            id: `notif_${Date.now()}_1234`,
            type: notifType,
            title: `Test ${notifType}`,
            message: 'Test message',
            duration: 4000,
            timestamp: Date.now(),
          },
        };

        expect(notification.data.type).toBe(notifType);
      });
    });

    test('should allow optional message field', () => {
      const notification: WSMessage = {
        type: 'notification',
        data: {
          id: 'notif_test',
          type: 'info',
          title: 'Title only',
          duration: 3000,
          timestamp: Date.now(),
        },
      };

      expect(notification.data.message).toBeUndefined();
      expect(notification.data.title).toBe('Title only');
    });
  });

  describe('Broadcast to Single Client', () => {
    test('should send notification to single connected client', () => {
      handler.handleConnection(mockWs1);

      const notification: WSMessage = {
        type: 'notification',
        data: {
          id: 'notif_001',
          type: 'success',
          title: 'Document created',
          message: 'new-doc',
          duration: 4000,
          timestamp: Date.now(),
        },
      };

      handler.broadcastNotification(notification.data);

      expect(mockWs1.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      expect(sentData.type).toBe('notification');
      expect(sentData.data.id).toBe('notif_001');
      expect(sentData.data.title).toBe('Document created');
    });

    test('should serialize notification data correctly', () => {
      handler.handleConnection(mockWs1);

      const now = Date.now();
      const notificationData = {
        id: 'notif_test_123',
        type: 'success' as const,
        title: 'Success notification',
        message: 'Operation completed',
        duration: 5000,
        timestamp: now,
      };

      handler.broadcastNotification(notificationData);

      const sentMessage = (mockWs1.send as any).mock.calls[0][0];
      const parsed = JSON.parse(sentMessage);

      expect(parsed).toEqual({
        type: 'notification',
        data: notificationData,
      });
    });
  });

  describe('Broadcast to Multiple Clients', () => {
    test('should send notification to all connected clients', () => {
      handler.handleConnection(mockWs1);
      handler.handleConnection(mockWs2);
      handler.handleConnection(mockWs3);

      const notificationData = {
        id: 'notif_multi_001',
        type: 'info' as const,
        title: 'Document updated',
        message: 'doc-456',
        duration: 4000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      expect(mockWs1.send).toHaveBeenCalledTimes(1);
      expect(mockWs2.send).toHaveBeenCalledTimes(1);
      expect(mockWs3.send).toHaveBeenCalledTimes(1);

      // Verify all received the same message
      const sent1 = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      const sent2 = JSON.parse((mockWs2.send as any).mock.calls[0][0]);
      const sent3 = JSON.parse((mockWs3.send as any).mock.calls[0][0]);

      expect(sent1).toEqual(sent2);
      expect(sent2).toEqual(sent3);
      expect(sent1.data.id).toBe('notif_multi_001');
    });

    test('should handle multiple notifications in sequence', () => {
      handler.handleConnection(mockWs1);
      handler.handleConnection(mockWs2);

      const notif1 = {
        id: 'notif_seq_001',
        type: 'success' as const,
        title: 'First notification',
        duration: 4000,
        timestamp: Date.now(),
      };

      const notif2 = {
        id: 'notif_seq_002',
        type: 'info' as const,
        title: 'Second notification',
        message: 'with message',
        duration: 3000,
        timestamp: Date.now() + 100,
      };

      handler.broadcastNotification(notif1);
      handler.broadcastNotification(notif2);

      expect(mockWs1.send).toHaveBeenCalledTimes(2);
      expect(mockWs2.send).toHaveBeenCalledTimes(2);

      const sent1First = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      const sent1Second = JSON.parse((mockWs1.send as any).mock.calls[1][0]);

      expect(sent1First.data.id).toBe('notif_seq_001');
      expect(sent1Second.data.id).toBe('notif_seq_002');
    });

    test('should not send to disconnected clients', () => {
      handler.handleConnection(mockWs1);
      handler.handleConnection(mockWs2);
      handler.handleConnection(mockWs3);

      // Disconnect one client
      handler.handleDisconnection(mockWs2);

      const notificationData = {
        id: 'notif_disconnected_001',
        type: 'warning' as const,
        title: 'Warning notification',
        duration: 4000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      expect(mockWs1.send).toHaveBeenCalledTimes(1);
      expect(mockWs2.send).not.toHaveBeenCalled();
      expect(mockWs3.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle send error on disconnected client gracefully', () => {
      handler.handleConnection(mockWs1);

      // Make the send throw an error (simulate disconnection during send)
      const mockWsError = {
        data: { subscriptions: new Set() },
        send: vi.fn(() => {
          throw new Error('WebSocket is closed');
        }),
      } as any;

      handler.handleConnection(mockWsError);

      const notificationData = {
        id: 'notif_error_001',
        type: 'error' as const,
        title: 'Error occurred',
        duration: 5000,
        timestamp: Date.now(),
      };

      // Should not throw, should handle gracefully
      expect(() => {
        handler.broadcastNotification(notificationData);
      }).not.toThrow();

      // Working client should still receive the message
      expect(mockWs1.send).toHaveBeenCalledTimes(1);
    });

    test('should continue broadcasting to other clients if one fails', () => {
      handler.handleConnection(mockWs1);

      const mockWsError = {
        data: { subscriptions: new Set() },
        send: vi.fn(() => {
          throw new Error('Send failed');
        }),
      } as any;

      handler.handleConnection(mockWsError);
      handler.handleConnection(mockWs3);

      const notificationData = {
        id: 'notif_partial_fail_001',
        type: 'info' as const,
        title: 'Partial failure test',
        duration: 4000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      // Both working clients should receive the message
      expect(mockWs1.send).toHaveBeenCalledTimes(1);
      expect(mockWs3.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Notification Data Format', () => {
    test('should preserve all notification fields in broadcast', () => {
      handler.handleConnection(mockWs1);

      const timestamp = Date.now();
      const notificationData = {
        id: 'notif_format_001',
        type: 'success' as const,
        title: 'Format test',
        message: 'Checking all fields',
        duration: 2500,
        timestamp,
      };

      handler.broadcastNotification(notificationData);

      const sent = JSON.parse((mockWs1.send as any).mock.calls[0][0]);

      expect(sent.type).toBe('notification');
      expect(sent.data.id).toBe('notif_format_001');
      expect(sent.data.type).toBe('success');
      expect(sent.data.title).toBe('Format test');
      expect(sent.data.message).toBe('Checking all fields');
      expect(sent.data.duration).toBe(2500);
      expect(sent.data.timestamp).toBe(timestamp);
    });

    test('should handle different notification types with different durations', () => {
      handler.handleConnection(mockWs1);

      const notifications = [
        {
          data: {
            id: 'notif_info',
            type: 'info' as const,
            title: 'Info',
            duration: 3000,
            timestamp: Date.now(),
          },
        },
        {
          data: {
            id: 'notif_success',
            type: 'success' as const,
            title: 'Success',
            duration: 2000,
            timestamp: Date.now(),
          },
        },
        {
          data: {
            id: 'notif_warning',
            type: 'warning' as const,
            title: 'Warning',
            duration: 4000,
            timestamp: Date.now(),
          },
        },
        {
          data: {
            id: 'notif_error',
            type: 'error' as const,
            title: 'Error',
            duration: 5000,
            timestamp: Date.now(),
          },
        },
      ];

      notifications.forEach((notif) => {
        handler.broadcastNotification(notif.data);
      });

      expect(mockWs1.send).toHaveBeenCalledTimes(4);

      notifications.forEach((notif, index) => {
        const sent = JSON.parse((mockWs1.send as any).mock.calls[index][0]);
        expect(sent.data.type).toBe(notif.data.type);
        expect(sent.data.duration).toBe(notif.data.duration);
      });
    });

    test('should handle notifications with and without message field', () => {
      handler.handleConnection(mockWs1);

      const withMessage = {
        id: 'notif_with_msg',
        type: 'info' as const,
        title: 'With message',
        message: 'This has a message',
        duration: 3000,
        timestamp: Date.now(),
      };

      const withoutMessage = {
        id: 'notif_without_msg',
        type: 'success' as const,
        title: 'Without message',
        duration: 4000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(withMessage);
      handler.broadcastNotification(withoutMessage);

      const sent1 = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      const sent2 = JSON.parse((mockWs1.send as any).mock.calls[1][0]);

      expect(sent1.data.message).toBe('This has a message');
      expect(sent2.data.message).toBeUndefined();
    });
  });

  describe('Concurrent Notifications', () => {
    test('should handle rapid concurrent notifications', () => {
      handler.handleConnection(mockWs1);
      handler.handleConnection(mockWs2);

      const notificationCount = 10;
      const notifications = Array.from({ length: notificationCount }, (_, i) => ({
        id: `notif_concurrent_${i}`,
        type: 'info' as const,
        title: `Notification ${i}`,
        duration: 3000,
        timestamp: Date.now() + i,
      }));

      notifications.forEach((notif) => {
        handler.broadcastNotification(notif);
      });

      expect(mockWs1.send).toHaveBeenCalledTimes(notificationCount);
      expect(mockWs2.send).toHaveBeenCalledTimes(notificationCount);

      // Verify order is preserved
      for (let i = 0; i < notificationCount; i++) {
        const sent = JSON.parse((mockWs1.send as any).mock.calls[i][0]);
        expect(sent.data.id).toBe(`notif_concurrent_${i}`);
      }
    });

    test('should handle notifications with client connect/disconnect during broadcast', () => {
      handler.handleConnection(mockWs1);

      const notif1 = {
        id: 'notif_timing_001',
        type: 'info' as const,
        title: 'First',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notif1);
      expect(mockWs1.send).toHaveBeenCalledTimes(1);

      // Add new client
      handler.handleConnection(mockWs2);

      const notif2 = {
        id: 'notif_timing_002',
        type: 'success' as const,
        title: 'Second',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notif2);

      expect(mockWs1.send).toHaveBeenCalledTimes(2);
      expect(mockWs2.send).toHaveBeenCalledTimes(1);

      // Remove client
      handler.handleDisconnection(mockWs1);

      const notif3 = {
        id: 'notif_timing_003',
        type: 'warning' as const,
        title: 'Third',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notif3);

      expect(mockWs1.send).toHaveBeenCalledTimes(2); // No new calls
      expect(mockWs2.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Integration with Other Broadcast Methods', () => {
    test('should not interfere with regular broadcast', () => {
      handler.handleConnection(mockWs1);

      const regularMessage: WSMessage = {
        type: 'diagram_updated',
        id: 'diag_001',
        content: 'graph TD; A --> B',
        lastModified: Date.now(),
      };

      const notification = {
        id: 'notif_001',
        type: 'info' as const,
        title: 'Diagram updated',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcast(regularMessage);
      handler.broadcastNotification(notification);

      expect(mockWs1.send).toHaveBeenCalledTimes(2);

      const sent1 = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      const sent2 = JSON.parse((mockWs1.send as any).mock.calls[1][0]);

      expect(sent1.type).toBe('diagram_updated');
      expect(sent2.type).toBe('notification');
    });

    test('should work alongside broadcastToDiagram', () => {
      handler.handleConnection(mockWs1);
      handler.handleConnection(mockWs2);

      mockWs1.data.subscriptions.add('diag_001');
      mockWs2.data.subscriptions.add('diag_002');

      const diagramMessage: WSMessage = {
        type: 'diagram_updated',
        id: 'diag_001',
        content: 'updated',
        lastModified: Date.now(),
      };

      const notification = {
        id: 'notif_002',
        type: 'success' as const,
        title: 'Diagram updated',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastToDiagram('diag_001', diagramMessage);
      handler.broadcastNotification(notification);

      // ws1 gets diagram update (subscribed) + notification (everyone)
      expect(mockWs1.send).toHaveBeenCalledTimes(2);

      // ws2 gets only notification (not subscribed to diag_001)
      expect(mockWs2.send).toHaveBeenCalledTimes(1);

      const ws2Sent = JSON.parse((mockWs2.send as any).mock.calls[0][0]);
      expect(ws2Sent.type).toBe('notification');
    });
  });

  describe('Edge Cases', () => {
    test('should handle notifications with empty message string', () => {
      handler.handleConnection(mockWs1);

      const notificationData = {
        id: 'notif_empty_msg',
        type: 'info' as const,
        title: 'Has empty message',
        message: '',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      const sent = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      expect(sent.data.message).toBe('');
    });

    test('should handle zero duration notifications', () => {
      handler.handleConnection(mockWs1);

      const notificationData = {
        id: 'notif_zero_duration',
        type: 'error' as const,
        title: 'Persistent notification',
        duration: 0,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      const sent = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      expect(sent.data.duration).toBe(0);
    });

    test('should handle very long notification titles and messages', () => {
      handler.handleConnection(mockWs1);

      const longString = 'a'.repeat(1000);

      const notificationData = {
        id: 'notif_long',
        type: 'warning' as const,
        title: longString,
        message: longString,
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      const sent = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      expect(sent.data.title.length).toBe(1000);
      expect(sent.data.message?.length).toBe(1000);
    });

    test('should handle special characters in notification text', () => {
      handler.handleConnection(mockWs1);

      const notificationData = {
        id: 'notif_special_chars',
        type: 'info' as const,
        title: 'Special: "quotes" \\backslash\n newline',
        message: 'Unicode: 你好 🎉 émoji',
        duration: 3000,
        timestamp: Date.now(),
      };

      handler.broadcastNotification(notificationData);

      const sent = JSON.parse((mockWs1.send as any).mock.calls[0][0]);
      expect(sent.data.title).toBe('Special: "quotes" \\backslash\n newline');
      expect(sent.data.message).toBe('Unicode: 你好 🎉 émoji');
    });

    test('should handle notifications with no connected clients', () => {
      const notificationData = {
        id: 'notif_no_clients',
        type: 'info' as const,
        title: 'Notification with no clients',
        duration: 3000,
        timestamp: Date.now(),
      };

      // Should not throw
      expect(() => {
        handler.broadcastNotification(notificationData);
      }).not.toThrow();
    });
  });
});
