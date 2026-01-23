/**
 * Comprehensive tests for WebSocket handler
 * Tests broadcast functionality, error handling, and memory leak prevention
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketHandler, type WSMessage } from '../websocket/handler';
import type { ServerWebSocket } from 'bun';

describe('WebSocketHandler', () => {
  let handler: WebSocketHandler;
  let mockWebSockets: Array<{ ws: any; send: any }>;

  beforeEach(() => {
    handler = new WebSocketHandler();
    mockWebSockets = [];
    vi.clearAllMocks();
  });

  /**
   * Helper to create mock WebSocket
   */
  function createMockWS(options: { shouldThrow?: boolean; throwOnAttempt?: number } = {}) {
    let sendCallCount = 0;
    const send = vi.fn(function (json: string) {
      sendCallCount++;
      if (options.shouldThrow || (options.throwOnAttempt && sendCallCount >= options.throwOnAttempt)) {
        throw new Error('WebSocket send failed');
      }
    });

    const ws = {
      send,
      data: {
        subscriptions: new Set<string>(),
      },
    } as unknown as ServerWebSocket<{ subscriptions: Set<string> }>;

    const tracker = { ws, send };
    mockWebSockets.push(tracker);
    return ws;
  }

  describe('broadcast()', () => {
    it('should broadcast message to all connected clients', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);

      const message: WSMessage = {
        type: 'ui_render',
        uiId: 'ui_123',
        project: 'test-project',
        session: 'test-session',
        ui: { type: 'form' },
        blocking: true,
        timestamp: Date.now(),
      };

      handler.broadcast(message);

      expect(mockWebSockets[0].send).toHaveBeenCalledOnce();
      expect(mockWebSockets[1].send).toHaveBeenCalledOnce();

      const sentMessage = JSON.parse(mockWebSockets[0].send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('ui_render');
      expect(sentMessage.uiId).toBe('ui_123');
    });

    it('should broadcast to multiple clients with correct message format', () => {
      const clients = [createMockWS(), createMockWS(), createMockWS()];
      clients.forEach((ws) => handler.handleConnection(ws));

      const message: WSMessage = {
        type: 'diagram_created',
        id: 'diagram_1',
        name: 'test.mmd',
      };

      handler.broadcast(message);

      expect(mockWebSockets).toHaveLength(3);
      mockWebSockets.forEach((tracker, index) => {
        expect(tracker.send).toHaveBeenCalledOnce();
        const sent = JSON.parse(tracker.send.mock.calls[0][0]);
        expect(sent.type).toBe('diagram_created');
        expect(sent.id).toBe('diagram_1');
      });
    });

    it('should handle and remove disconnected clients on send error', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS({ shouldThrow: true });
      const ws3 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);
      handler.handleConnection(ws3);

      expect(handler.getConnectionCount()).toBe(3);

      const message: WSMessage = {
        type: 'ui_render',
        uiId: 'ui_456',
        project: 'proj',
        session: 'sess',
        ui: { type: 'button' },
        blocking: false,
        timestamp: Date.now(),
      };

      // Suppress console.error for this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      handler.broadcast(message);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(handler.getConnectionCount()).toBe(2); // Dead connection removed
      expect(mockWebSockets[0].send).toHaveBeenCalled();
      expect(mockWebSockets[2].send).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should prevent memory leaks from stale connections', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS({ shouldThrow: true });
      const ws3 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);
      handler.handleConnection(ws3);

      const initialCount = handler.getConnectionCount();
      expect(initialCount).toBe(3);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // First broadcast: ws2 fails and should be cleaned up
      handler.broadcast({ type: 'connected', diagramCount: 0 });
      expect(handler.getConnectionCount()).toBe(2);

      // Second broadcast: only remaining valid connections should receive
      handler.broadcast({ type: 'diagram_created', id: 'test', name: 'test.mmd' });
      expect(mockWebSockets[0].send).toHaveBeenCalledTimes(2); // Called in both broadcasts
      expect(mockWebSockets[2].send).toHaveBeenCalledTimes(2); // Called in both broadcasts
      expect(mockWebSockets[1].send).toHaveBeenCalledOnce(); // Only first broadcast, then removed

      consoleErrorSpy.mockRestore();
    });

    it('should serialize ui_render message with correct format', () => {
      const ws = createMockWS();
      handler.handleConnection(ws);

      const uiComponent = {
        type: 'form',
        props: { title: 'Test Form' },
        children: [],
      };

      const message: WSMessage = {
        type: 'ui_render',
        uiId: 'ui_test_12345_abc123',
        project: 'my-project',
        session: 'my-session',
        ui: uiComponent,
        blocking: true,
        timestamp: 1234567890,
      };

      handler.broadcast(message);

      const sentJson = mockWebSockets[0].send.mock.calls[0][0];
      const parsed = JSON.parse(sentJson);

      expect(parsed).toMatchObject({
        type: 'ui_render',
        uiId: 'ui_test_12345_abc123',
        project: 'my-project',
        session: 'my-session',
        blocking: true,
        timestamp: 1234567890,
      });
      expect(parsed.ui).toEqual(uiComponent);
    });
  });

  describe('broadcastToDiagram()', () => {
    it('should broadcast only to subscribed clients', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS();
      const ws3 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);
      handler.handleConnection(ws3);

      // Subscribe ws1 and ws3 to diagram_1
      ws1.data.subscriptions.add('diagram_1');
      ws3.data.subscriptions.add('diagram_1');

      const message: WSMessage = {
        type: 'diagram_updated',
        id: 'diagram_1',
        content: 'graph TD; A-->B',
        lastModified: Date.now(),
      };

      handler.broadcastToDiagram('diagram_1', message);

      expect(mockWebSockets[0].send).toHaveBeenCalledOnce(); // ws1 subscribed
      expect(mockWebSockets[1].send).not.toHaveBeenCalled(); // ws2 not subscribed
      expect(mockWebSockets[2].send).toHaveBeenCalledOnce(); // ws3 subscribed
    });

    it('should clean up disconnected clients in broadcastToDiagram', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS({ shouldThrow: true });

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);

      ws1.data.subscriptions.add('diagram_1');
      ws2.data.subscriptions.add('diagram_1');

      expect(handler.getConnectionCount()).toBe(2);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const message: WSMessage = {
        type: 'diagram_deleted',
        id: 'diagram_1',
      };

      handler.broadcastToDiagram('diagram_1', message);

      expect(handler.getConnectionCount()).toBe(1); // ws2 removed
      expect(mockWebSockets[0].send).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('broadcastToDocument()', () => {
    it('should broadcast only to document subscribers', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);

      ws1.data.subscriptions.add('doc_1');

      const message: WSMessage = {
        type: 'document_updated',
        id: 'doc_1',
        content: '# Test Document',
        lastModified: Date.now(),
      };

      handler.broadcastToDocument('doc_1', message);

      expect(mockWebSockets[0].send).toHaveBeenCalledOnce();
      expect(mockWebSockets[1].send).not.toHaveBeenCalled();
    });

    it('should handle errors in broadcastToDocument', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS({ shouldThrow: true });

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);

      ws1.data.subscriptions.add('doc_1');
      ws2.data.subscriptions.add('doc_1');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const message: WSMessage = {
        type: 'document_created',
        id: 'doc_1',
        name: 'new-doc.md',
      };

      handler.broadcastToDocument('doc_1', message);

      expect(mockWebSockets[0].send).toHaveBeenCalled();
      expect(handler.getConnectionCount()).toBe(1);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('handleConnection() and handleDisconnection()', () => {
    it('should track connection count correctly', () => {
      expect(handler.getConnectionCount()).toBe(0);

      const ws1 = createMockWS();
      handler.handleConnection(ws1);
      expect(handler.getConnectionCount()).toBe(1);

      const ws2 = createMockWS();
      handler.handleConnection(ws2);
      expect(handler.getConnectionCount()).toBe(2);

      handler.handleDisconnection(ws1);
      expect(handler.getConnectionCount()).toBe(1);

      handler.handleDisconnection(ws2);
      expect(handler.getConnectionCount()).toBe(0);
    });

    it('should initialize subscriptions for new connections', () => {
      const ws = createMockWS();
      expect(ws.data.subscriptions.size).toBe(0);

      handler.handleConnection(ws);
      expect(ws.data.subscriptions instanceof Set).toBe(true);
      expect(ws.data.subscriptions.size).toBe(0);
    });
  });

  describe('Message type validation', () => {
    it('should accept ui_render message type', () => {
      const ws = createMockWS();
      handler.handleConnection(ws);

      const message: WSMessage = {
        type: 'ui_render',
        uiId: 'ui_123',
        project: 'test',
        session: 'session',
        ui: { type: 'dialog' },
        blocking: true,
        timestamp: Date.now(),
      };

      expect(() => handler.broadcast(message)).not.toThrow();
      expect(mockWebSockets[0].send).toHaveBeenCalled();
    });

    it('should handle diagram_updated message format', () => {
      const ws = createMockWS();
      handler.handleConnection(ws);

      const message: WSMessage = {
        type: 'diagram_updated',
        id: 'diagram_1',
        content: 'graph TD; A-->B',
        lastModified: 1234567890,
        patch: {
          oldString: 'graph TD; A-->B',
          newString: 'graph TD; A-->B; C-->D',
        },
      };

      handler.broadcast(message);
      expect(mockWebSockets[0].send).toHaveBeenCalled();

      const sent = JSON.parse(mockWebSockets[0].send.mock.calls[0][0]);
      expect(sent.type).toBe('diagram_updated');
      expect(sent.patch).toBeDefined();
    });
  });

  describe('Error handling and robustness', () => {
    it('should continue broadcasting after one client fails', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS({ shouldThrow: true });
      const ws3 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);
      handler.handleConnection(ws3);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const message: WSMessage = {
        type: 'connected',
        diagramCount: 5,
      };

      handler.broadcast(message);

      // ws1 and ws3 should have received the message
      expect(mockWebSockets[0].send).toHaveBeenCalled();
      expect(mockWebSockets[2].send).toHaveBeenCalled();
      // ws2 failed and was removed from connections
      expect(handler.getConnectionCount()).toBe(2);

      consoleErrorSpy.mockRestore();
    });

    it('should not accumulate stale connections', () => {
      const deadWS = createMockWS({ shouldThrow: true });
      handler.handleConnection(deadWS);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Multiple broadcast attempts should clean up the same dead connection only once
      handler.broadcast({ type: 'connected', diagramCount: 0 });
      expect(handler.getConnectionCount()).toBe(0);

      handler.broadcast({ type: 'diagram_created', id: 'test', name: 'test.mmd' });
      expect(handler.getConnectionCount()).toBe(0);

      // Dead connection should only be cleaned up once
      expect(mockWebSockets[0].send).toHaveBeenCalledOnce();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Concurrent operations', () => {
    it('should handle rapid consecutive broadcasts', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);

      const messages: WSMessage[] = [
        { type: 'connected', diagramCount: 0 },
        { type: 'diagram_created', id: 'diagram_1', name: 'test.mmd' },
        {
          type: 'ui_render',
          uiId: 'ui_123',
          project: 'proj',
          session: 'sess',
          ui: { type: 'form' },
          blocking: true,
          timestamp: Date.now(),
        },
      ];

      messages.forEach((msg) => handler.broadcast(msg));

      expect(mockWebSockets[0].send).toHaveBeenCalledTimes(3);
      expect(mockWebSockets[1].send).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed subscribe/broadcast operations', () => {
      const ws1 = createMockWS();
      const ws2 = createMockWS();

      handler.handleConnection(ws1);
      handler.handleConnection(ws2);

      // Subscribe ws1 to diagram
      ws1.data.subscriptions.add('diagram_1');

      // Broadcast to all
      handler.broadcast({ type: 'connected', diagramCount: 1 });

      // Broadcast to diagram (only ws1)
      handler.broadcastToDiagram('diagram_1', {
        type: 'diagram_updated',
        id: 'diagram_1',
        content: 'test',
        lastModified: Date.now(),
      });

      // ws1 should have 2 messages, ws2 should have 1
      expect(mockWebSockets[0].send).toHaveBeenCalledTimes(2);
      expect(mockWebSockets[1].send).toHaveBeenCalledOnce();
    });
  });
});
