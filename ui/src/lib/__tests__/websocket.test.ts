/**
 * WebSocket Client Tests
 *
 * Tests verify:
 * - Connection establishment and disconnection
 * - Message sending and receiving
 * - Event emitter pattern (onMessage, onConnect, onDisconnect)
 * - Automatic reconnection with exponential backoff
 * - Message queuing while disconnected
 * - Subscription/unsubscription to channels
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient, getWebSocketClient, resetWebSocketClient, type WebSocketMessage } from '../websocket';

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  simulateOpen(): void {
    this.readyState = WebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateMessage(data: WebSocketMessage): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateClose(): void {
    this.close();
  }
}

// Store original WebSocket
const OriginalWebSocket = global.WebSocket;
let mockWebSocketInstance: MockWebSocket | null = null;

// Replace global WebSocket
(global as any).WebSocket = class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    mockWebSocketInstance = this;
  }
};

describe('WebSocketClient', () => {
  beforeEach(() => {
    mockWebSocketInstance = null;
    resetWebSocketClient();
  });

  afterEach(() => {
    if (mockWebSocketInstance) {
      mockWebSocketInstance.close();
    }
    resetWebSocketClient();
  });

  describe('Basic Connection', () => {
    it('should create a new WebSocket instance', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      expect(mockWebSocketInstance).toBeDefined();
      expect(mockWebSocketInstance!.url).toBe('ws://localhost:3737/ws');

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;
    });

    it('should establish connection successfully', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      expect(client.isConnected()).toBe(true);
    });

    it('should disconnect from server', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      expect(client.isConnected()).toBe(true);

      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should not reconnect when intentionally disconnected', async () => {
      vi.useFakeTimers();

      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const wsBeforeDisconnect = mockWebSocketInstance;
      client.disconnect();

      // Fast forward time to check for reconnection
      vi.advanceTimersByTime(2000);

      // Should not have created a new instance
      expect(mockWebSocketInstance).toBe(wsBeforeDisconnect);

      vi.useRealTimers();
    });
  });

  describe('Message Communication', () => {
    it('should send message when connected', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const message: WebSocketMessage = { type: 'subscribe', channel: 'diagrams' };
      client.send(message);

      expect(mockWebSocketInstance!.sentMessages).toContainEqual(JSON.stringify(message));
    });

    it('should queue message while disconnected', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const message: WebSocketMessage = { type: 'test', data: 'hello' };

      // Send while not connected
      client.send(message);

      // Now connect and verify message was sent
      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      expect(mockWebSocketInstance!.sentMessages).toContainEqual(JSON.stringify(message));
    });

    it('should receive and dispatch messages', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const receivedMessages: WebSocketMessage[] = [];
      client.onMessage((msg) => {
        receivedMessages.push(msg);
      });

      const testMessage: WebSocketMessage = { type: 'diagram_updated', id: '123', content: 'test' };
      mockWebSocketInstance!.simulateMessage(testMessage);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual(testMessage);
    });

    it('should handle multiple messages', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const receivedMessages: WebSocketMessage[] = [];
      client.onMessage((msg) => {
        receivedMessages.push(msg);
      });

      const msg1: WebSocketMessage = { type: 'diagram_updated', id: '1' };
      const msg2: WebSocketMessage = { type: 'document_updated', id: '2' };
      const msg3: WebSocketMessage = { type: 'question', questionId: '3' };

      mockWebSocketInstance!.simulateMessage(msg1);
      mockWebSocketInstance!.simulateMessage(msg2);
      mockWebSocketInstance!.simulateMessage(msg3);

      expect(receivedMessages).toHaveLength(3);
      expect(receivedMessages[0]).toEqual(msg1);
      expect(receivedMessages[1]).toEqual(msg2);
      expect(receivedMessages[2]).toEqual(msg3);
    });

    it('should handle malformed messages gracefully', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const receivedMessages: WebSocketMessage[] = [];
      client.onMessage((msg) => {
        receivedMessages.push(msg);
      });

      // Send invalid JSON
      if (mockWebSocketInstance!.onmessage) {
        mockWebSocketInstance!.onmessage(new MessageEvent('message', { data: 'invalid json' }));
      }

      // Should have logged error but not crashed
      expect(consoleSpy).toHaveBeenCalledWith('Failed to parse WebSocket message:', expect.any(Error));
      expect(receivedMessages).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });

  describe('Event Emitter Pattern', () => {
    it('should emit connect event when connected', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectSpy = vi.fn();

      client.onConnect(connectSpy);

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      expect(connectSpy).toHaveBeenCalledOnce();
    });

    it('should emit disconnect event when disconnected', async () => {
      vi.useFakeTimers();

      const client = new WebSocketClient('ws://localhost:3737/ws');
      const disconnectSpy = vi.fn();

      client.onDisconnect(disconnectSpy);

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      mockWebSocketInstance!.simulateClose();

      expect(disconnectSpy).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });

    it('should support multiple listeners', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      client.onMessage(handler1);
      client.onMessage(handler2);
      client.onMessage(handler3);

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const message: WebSocketMessage = { type: 'test' };
      mockWebSocketInstance!.simulateMessage(message);

      expect(handler1).toHaveBeenCalledWith(message);
      expect(handler2).toHaveBeenCalledWith(message);
      expect(handler3).toHaveBeenCalledWith(message);
    });

    it('should allow unsubscribing from events', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const handler = vi.fn();

      const subscription = client.onMessage(handler);

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const message1: WebSocketMessage = { type: 'test1' };
      mockWebSocketInstance!.simulateMessage(message1);

      expect(handler).toHaveBeenCalledOnce();

      // Unsubscribe
      subscription.unsubscribe();

      const message2: WebSocketMessage = { type: 'test2' };
      mockWebSocketInstance!.simulateMessage(message2);

      expect(handler).toHaveBeenCalledOnce(); // Still only once
    });
  });

  describe('Automatic Reconnection', () => {
    it('should attempt to reconnect on disconnect', async () => {
      vi.useFakeTimers();

      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const wsBeforeClose = mockWebSocketInstance;

      // Disconnect
      mockWebSocketInstance!.simulateClose();

      // Fast-forward time to trigger reconnection
      vi.advanceTimersByTime(1100); // 1000ms + buffer

      // Should have attempted to create a new WebSocket instance
      expect(mockWebSocketInstance).not.toBe(wsBeforeClose);

      vi.useRealTimers();
    });

    it('should use exponential backoff for reconnection', () => {
      vi.useFakeTimers();

      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // First disconnect - should retry after 1s
      mockWebSocketInstance!.simulateClose();

      // Check log for first attempt
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1/5')
      );

      // Simulate new WebSocket instance and close it
      mockWebSocketInstance!.simulateClose();

      // Check log for second attempt (delay should be 2000ms)
      const calls = consoleSpy.mock.calls;
      const secondAttemptCall = calls.find((c) => c[0].includes('attempt 2/5'));
      expect(secondAttemptCall).toBeDefined();

      vi.useRealTimers();
      consoleSpy.mockRestore();
    });

    it('should stop reconnecting after max attempts', () => {
      vi.useFakeTimers();

      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Trigger max reconnection attempts
      for (let i = 0; i < 5; i++) {
        mockWebSocketInstance!.simulateClose();
        vi.advanceTimersByTime(32000); // Advance past the max backoff time
      }

      const logCalls = consoleSpy.mock.calls.filter((call) =>
        call[0].includes('attempt')
      );

      expect(logCalls.length).toBeLessThanOrEqual(5);

      vi.useRealTimers();
      consoleSpy.mockRestore();
    });
  });

  describe('Channel Subscription', () => {
    it('should send subscribe message', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      client.subscribe('diagrams');

      const lastMessage = mockWebSocketInstance!.sentMessages[0];
      const parsed = JSON.parse(lastMessage);

      expect(parsed.type).toBe('subscribe');
      expect(parsed.channel).toBe('diagrams');
    });

    it('should send unsubscribe message', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const connectPromise = client.connect();

      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      client.unsubscribe('documents');

      const lastMessage = mockWebSocketInstance!.sentMessages[0];
      const parsed = JSON.parse(lastMessage);

      expect(parsed.type).toBe('unsubscribe');
      expect(parsed.channel).toBe('documents');
    });

    it('should queue subscription while disconnected', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');

      client.subscribe('diagrams');

      // Connect
      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      // Verify subscription was sent
      const messages = mockWebSocketInstance!.sentMessages.map((m) => JSON.parse(m));
      expect(messages).toContainEqual({
        type: 'subscribe',
        channel: 'diagrams',
      });
    });
  });

  describe('Pending Message Flushing', () => {
    it('should flush pending messages on reconnect', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');

      // Send messages while disconnected
      client.send({ type: 'msg1' });
      client.send({ type: 'msg2' });
      client.send({ type: 'msg3' });

      // Connect
      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      // All messages should have been sent
      const messages = mockWebSocketInstance!.sentMessages.map((m) => JSON.parse(m));
      expect(messages).toContainEqual({ type: 'msg1' });
      expect(messages).toContainEqual({ type: 'msg2' });
      expect(messages).toContainEqual({ type: 'msg3' });
    });

    it('should maintain order of pending messages', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');

      client.send({ type: 'first', seq: 1 });
      client.send({ type: 'second', seq: 2 });
      client.send({ type: 'third', seq: 3 });

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      const messages = mockWebSocketInstance!.sentMessages.map((m) => JSON.parse(m));
      expect(messages[0].seq).toBe(1);
      expect(messages[1].seq).toBe(2);
      expect(messages[2].seq).toBe(3);
    });
  });

  describe('Shared Client Instance', () => {
    it('should provide singleton WebSocket client', () => {
      const client1 = getWebSocketClient('ws://localhost:3737/ws');
      const client2 = getWebSocketClient('ws://localhost:3737/ws');

      expect(client1).toBe(client2);
    });

    it('should create new instance with different URL', async () => {
      resetWebSocketClient();
      const client1 = getWebSocketClient('ws://localhost:3737/ws');

      resetWebSocketClient();
      const client2 = getWebSocketClient('ws://localhost:8080/ws');

      expect(client1).not.toBe(client2);
    });

    it('should reset shared client', () => {
      const client1 = getWebSocketClient('ws://localhost:3737/ws');
      resetWebSocketClient();
      const client2 = getWebSocketClient('ws://localhost:3737/ws');

      expect(client1).not.toBe(client2);
    });
  });

  describe('Real-time Message Flows', () => {
    it('should handle diagram update flow', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const updates: WebSocketMessage[] = [];

      client.onMessage((msg) => {
        if (msg.type === 'diagram_updated') {
          updates.push(msg);
        }
      });

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      // Subscribe to diagrams
      client.subscribe('diagrams');

      // Receive diagram updates
      mockWebSocketInstance!.simulateMessage({
        type: 'diagram_updated',
        id: 'diagram-1',
        content: 'graph LR\n  A --> B',
        timestamp: Date.now(),
      });

      mockWebSocketInstance!.simulateMessage({
        type: 'diagram_updated',
        id: 'diagram-2',
        content: 'graph TB\n  X[Start]',
        timestamp: Date.now(),
      });

      expect(updates).toHaveLength(2);
      expect(updates[0].id).toBe('diagram-1');
      expect(updates[1].id).toBe('diagram-2');
    });

    it('should handle question event flow', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const questions: WebSocketMessage[] = [];

      client.onMessage((msg) => {
        if (msg.type === 'question') {
          questions.push(msg);
        }
      });

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      // Receive question from Claude
      const questionMsg: WebSocketMessage = {
        type: 'question',
        id: 'q-123',
        ui: {
          type: 'MultipleChoice',
          props: {
            options: [
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
            ],
          },
        },
        timestamp: Date.now(),
      };

      mockWebSocketInstance!.simulateMessage(questionMsg);

      expect(questions).toHaveLength(1);
      expect(questions[0].id).toBe('q-123');
    });

    it('should handle mixed message types', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const allMessages: WebSocketMessage[] = [];

      client.onMessage((msg) => {
        allMessages.push(msg);
      });

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      mockWebSocketInstance!.simulateMessage({ type: 'diagram_updated', id: '1' });
      mockWebSocketInstance!.simulateMessage({ type: 'question', id: 'q-1' });
      mockWebSocketInstance!.simulateMessage({ type: 'document_updated', id: 'd-1' });
      mockWebSocketInstance!.simulateMessage({ type: 'status', message: 'Processing...' });

      expect(allMessages).toHaveLength(4);
      expect(allMessages[0].type).toBe('diagram_updated');
      expect(allMessages[1].type).toBe('question');
      expect(allMessages[2].type).toBe('document_updated');
      expect(allMessages[3].type).toBe('status');
    });
  });

  describe('Error Handling', () => {
    it('should log errors to console', async () => {
      const client = new WebSocketClient('ws://localhost:3737/ws');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      mockWebSocketInstance!.simulateError();

      expect(consoleSpy).toHaveBeenCalledWith('WebSocket error:', expect.any(Event));

      consoleSpy.mockRestore();
    });

    it('should continue functioning after error', async () => {
      vi.useFakeTimers();

      const client = new WebSocketClient('ws://localhost:3737/ws');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const connectPromise = client.connect();
      mockWebSocketInstance!.simulateOpen();
      await connectPromise;

      mockWebSocketInstance!.simulateError();
      mockWebSocketInstance!.simulateClose();

      // Should still be functional (can check connection status, etc.)
      expect(client.isConnected()).toBe(false);

      vi.useRealTimers();
      consoleSpy.mockRestore();
    });
  });
});
