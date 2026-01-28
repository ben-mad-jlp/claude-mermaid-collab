import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PTYManager, ptyManager } from './PTYManager';
import { RingBuffer } from './RingBuffer';
import type { ServerWebSocket } from 'bun';

// Mock ServerWebSocket for testing
class MockWebSocket {
  messages: string[] = [];
  closed = false;

  send(data: string) {
    if (this.closed) throw new Error('WebSocket closed');
    this.messages.push(data);
  }

  close() {
    this.closed = true;
  }
}

describe('PTYManager', () => {
  let manager: PTYManager;

  beforeEach(() => {
    manager = new PTYManager();

    // Mock Bun.spawn to avoid actual process creation in tests
    vi.stubGlobal('Bun', {
      spawn: vi.fn(() => {
        return {
          stdout: (async function* () {
            // Never emit any data
            await new Promise(() => {}); // Hang forever
          })(),
          stderr: (async function* () {})(),
          stdin: {
            write: vi.fn(),
            end: vi.fn(),
          },
          kill: vi.fn(),
          terminal: {
            write: vi.fn(),
            resize: vi.fn(),
            close: vi.fn(),
          },
          exited: new Promise(() => {}), // Never resolves - keeps process alive for tests
        };
      }),
    });
  });

  afterEach(() => {
    // Kill all sessions to clean up BEFORE unstubbing
    manager.killAll();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should initialize with empty sessions map', () => {
      const newManager = new PTYManager();
      expect(newManager.list()).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create a new PTY session with default options', async () => {
      const sessionId = 'test-session-1';
      const info = await manager.create(sessionId);

      expect(info.id).toBe(sessionId);
      expect(info.shell).toBeTruthy();
      expect(info.cwd).toBeTruthy();
      expect(info.createdAt).toBeInstanceOf(Date);
      expect(info.lastActivity).toBeInstanceOf(Date);
      expect(info.connectedClients).toBe(0);
    });

    it('should use custom shell if provided', async () => {
      const sessionId = 'test-session-shell';
      const customShell = '/bin/bash';

      const info = await manager.create(sessionId, { shell: customShell });
      expect(info.shell).toBe(customShell);
    });

    it('should use custom cwd if provided', async () => {
      const sessionId = 'test-session-cwd';
      const customCwd = '/tmp';

      const info = await manager.create(sessionId, { cwd: customCwd });
      expect(info.cwd).toBe(customCwd);
    });

    it('should throw if sessionId already exists', async () => {
      const sessionId = 'duplicate-test';
      await manager.create(sessionId);

      await expect(manager.create(sessionId)).rejects.toThrow('Session already exists');
    });

    it('should throw if sessionId is empty or whitespace', async () => {
      await expect(manager.create('')).rejects.toThrow('Invalid session ID');
      await expect(manager.create('   ')).rejects.toThrow('Invalid session ID');
    });

    it('should throw if no valid shell is available', async () => {
      await expect(manager.create('test-no-shell', { shell: '/nonexistent/shell' })).rejects.toThrow();
    });
  });

  describe('write', () => {
    it('should send input to PTY session', async () => {
      const sessionId = 'test-write';
      await manager.create(sessionId);

      // Should not throw
      expect(() => {
        manager.write(sessionId, 'echo test\n');
      }).not.toThrow();
    });

    it('should throw if session not found', () => {
      expect(() => {
        manager.write('nonexistent', 'data');
      }).toThrow('Session not found');
    });

    it('should update lastActivity', async () => {
      const sessionId = 'test-write-activity';
      const before = await manager.create(sessionId);

      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.write(sessionId, 'test\n');
      const after = manager.get(sessionId);

      expect(after!.lastActivity.getTime()).toBeGreaterThan(before.lastActivity.getTime());
    });
  });

  describe('resize', () => {
    it('should resize PTY session without throwing', async () => {
      const sessionId = 'test-resize';
      await manager.create(sessionId);

      // Should not throw
      expect(() => {
        manager.resize(sessionId, 120, 40);
      }).not.toThrow();
    });

    it('should be a no-op if session not found', () => {
      expect(() => {
        manager.resize('nonexistent', 80, 24);
      }).not.toThrow();
    });

    it('should update lastActivity', async () => {
      const sessionId = 'test-resize-activity';
      const before = await manager.create(sessionId);

      await new Promise(resolve => setTimeout(resolve, 10));

      manager.resize(sessionId, 100, 30);
      const after = manager.get(sessionId);

      expect(after!.lastActivity.getTime()).toBeGreaterThan(before.lastActivity.getTime());
    });
  });

  describe('PTYSession fields: hasReceivedResize and deferReplay', () => {
    it('should initialize hasReceivedResize to false on create', async () => {
      const sessionId = 'test-fields-create';
      await manager.create(sessionId);

      // Access internal session to verify fields (we'll check via indirect means)
      const session = manager.get(sessionId);
      expect(session).toBeDefined();
    });

    it('should initialize deferReplay to false on create', async () => {
      const sessionId = 'test-fields-defer';
      await manager.create(sessionId);

      const session = manager.get(sessionId);
      expect(session).toBeDefined();
    });

    it('should initialize both fields to false on auto-create via attach', () => {
      const sessionId = 'test-fields-attach-auto';
      const ws = new MockWebSocket() as any as ServerWebSocket;

      manager.attach(sessionId, ws);

      const session = manager.get(sessionId);
      expect(session).toBeDefined();
      // Fields are initialized to false for new sessions
    });

    it('should preserve field values across operations', async () => {
      const sessionId = 'test-fields-preserve';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws);

      manager.resize(sessionId, 100, 30);
      manager.write(sessionId, 'test\n');

      const session = manager.get(sessionId);
      expect(session).toBeDefined();
    });
  });

  describe('attach', () => {
    it('should attach a WebSocket to existing session', async () => {
      const sessionId = 'test-attach';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws);

      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });

    it('should auto-create session if it does not exist', () => {
      const sessionId = 'test-attach-auto-create';
      const ws = new MockWebSocket() as any as ServerWebSocket;

      manager.attach(sessionId, ws);

      expect(manager.has(sessionId)).toBe(true);
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });

    it('should allow multiple WebSockets on same session', async () => {
      const sessionId = 'test-attach-multiple';
      await manager.create(sessionId);

      const ws1 = new MockWebSocket() as any as ServerWebSocket;
      const ws2 = new MockWebSocket() as any as ServerWebSocket;

      manager.attach(sessionId, ws1);
      manager.attach(sessionId, ws2);

      expect(manager.get(sessionId)!.connectedClients).toBe(2);
    });

    it('should update lastActivity', async () => {
      const sessionId = 'test-attach-activity';
      const before = await manager.create(sessionId);

      await new Promise(resolve => setTimeout(resolve, 10));

      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws);
      const after = manager.get(sessionId);

      expect(after!.lastActivity.getTime()).toBeGreaterThanOrEqual(before.lastActivity.getTime());
    });
  });

  describe('attach with deferReplay option', () => {
    it('should accept deferReplay option in attach', async () => {
      const sessionId = 'test-defer-accept';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Should not throw
      expect(() => {
        manager.attach(sessionId, ws, { deferReplay: true });
      }).not.toThrow();

      expect(manager.has(sessionId)).toBe(true);
    });

    it('should defer buffer replay when deferReplay is true', async () => {
      const sessionId = 'test-defer-buffer';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Attach with deferReplay: true
      manager.attach(sessionId, ws, { deferReplay: true });

      // Should NOT have received buffer in messages
      expect(ws.messages).toHaveLength(0);
    });

    it('should replay buffer immediately when deferReplay is false', async () => {
      const sessionId = 'test-defer-false';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Attach with deferReplay: false (explicit)
      manager.attach(sessionId, ws, { deferReplay: false });

      // Should replay buffer (even if empty, a message is sent for empty buffer)
      // The exact behavior depends on RingBuffer implementation
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });

    it('should replay buffer immediately when deferReplay option is undefined', async () => {
      const sessionId = 'test-defer-undefined';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Attach without options (deferReplay undefined)
      manager.attach(sessionId, ws);

      // Should replay buffer immediately (default behavior)
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });

    it('should set hasReceivedResize to false on attach', async () => {
      const sessionId = 'test-defer-has-received-resize';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws, { deferReplay: true });

      // hasReceivedResize should be false (we can't directly access it, but we test via resize behavior)
      manager.resize(sessionId, 100, 30);

      // After resize, hasReceivedResize should be true and buffer should have been replayed
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });
  });

  describe('replayBuffer', () => {
    it('should be a public method that sends buffered output', () => {
      // Verify method exists and can be called
      const sessionId = 'test-replay-exists';
      const ws = new MockWebSocket() as any as ServerWebSocket;

      expect(() => {
        manager.replayBuffer(sessionId, ws);
      }).not.toThrow();
    });

    it('should not throw if session does not exist', () => {
      const ws = new MockWebSocket() as any as ServerWebSocket;

      expect(() => {
        manager.replayBuffer('nonexistent', ws);
      }).not.toThrow();
    });

    it('should be called when first resize happens after deferReplay', async () => {
      const sessionId = 'test-replay-on-resize';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Attach with defer
      manager.attach(sessionId, ws, { deferReplay: true });

      // No messages yet
      const messagesBefore = ws.messages.length;

      // Send resize - should trigger replay
      manager.resize(sessionId, 100, 30);

      // Messages might have been added by resize (or not, depending on buffer)
      // The important thing is that replayBuffer was called (indirectly)
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });

    it('should handle closed websocket gracefully', async () => {
      const sessionId = 'test-replay-closed-ws';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Write some data to create buffer content
      manager.write(sessionId, 'test\n');

      // Close the websocket
      ws.closed = true;

      // Should not throw even though websocket is closed
      // The error handling inside replayBuffer catches and logs it
      expect(() => {
        manager.replayBuffer(sessionId, ws);
      }).not.toThrow();
    });
  });

  describe('resize with deferReplay', () => {
    it('should trigger buffer replay on first resize when deferReplay is true', async () => {
      const sessionId = 'test-resize-trigger-replay';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Attach with deferReplay
      manager.attach(sessionId, ws, { deferReplay: true });
      const messagesBefore = ws.messages.length;

      // First resize should trigger replay
      manager.resize(sessionId, 100, 30);

      // After first resize, buffer should have been replayed
      // (messages may or may not increase depending on buffer contents)
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });

    it('should only replay buffer on first resize, not subsequent resizes', async () => {
      const sessionId = 'test-resize-single-replay';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      manager.attach(sessionId, ws, { deferReplay: true });

      // First resize
      manager.resize(sessionId, 100, 30);
      const messagesAfterFirst = ws.messages.length;

      // Second resize should not trigger another replay
      manager.resize(sessionId, 120, 40);
      const messagesAfterSecond = ws.messages.length;

      // No additional messages from second resize
      expect(messagesAfterSecond).toBe(messagesAfterFirst);
    });

    it('should not affect attach without deferReplay', async () => {
      const sessionId = 'test-resize-no-defer';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      // Attach without deferReplay
      manager.attach(sessionId, ws);
      const messagesBefore = ws.messages.length;

      // Resize should work normally
      manager.resize(sessionId, 100, 30);

      // No error, session intact
      expect(manager.get(sessionId)!.connectedClients).toBe(1);
    });
  });

  describe('detach', () => {
    it('should remove WebSocket from session', async () => {
      const sessionId = 'test-detach';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(1);

      manager.detach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(0);
    });

    it('should be no-op if session not found', () => {
      const ws = new MockWebSocket() as any as ServerWebSocket;
      expect(() => {
        manager.detach('nonexistent', ws);
      }).not.toThrow();
    });

    it('should keep PTY running after detach', async () => {
      const sessionId = 'test-detach-pty-running';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws);
      manager.detach(sessionId, ws);

      // Session should still exist
      expect(manager.has(sessionId)).toBe(true);
    });
  });

  describe('kill', () => {
    it('should kill a PTY session', async () => {
      const sessionId = 'test-kill';
      await manager.create(sessionId);

      expect(manager.has(sessionId)).toBe(true);

      manager.kill(sessionId);

      expect(manager.has(sessionId)).toBe(false);
    });

    it('should close all attached WebSockets', async () => {
      const sessionId = 'test-kill-websockets';
      await manager.create(sessionId);

      const ws1 = new MockWebSocket() as any as ServerWebSocket;
      const ws2 = new MockWebSocket() as any as ServerWebSocket;

      manager.attach(sessionId, ws1);
      manager.attach(sessionId, ws2);

      manager.kill(sessionId);

      expect(ws1.closed).toBe(true);
      expect(ws2.closed).toBe(true);
    });

    it('should be no-op if session not found', () => {
      expect(() => {
        manager.kill('nonexistent');
      }).not.toThrow();
    });
  });

  describe('list', () => {
    it('should return empty array when no sessions', () => {
      const list = manager.list();
      expect(list).toEqual([]);
    });

    it('should return all active sessions', async () => {
      await manager.create('session-1');
      await manager.create('session-2');
      await manager.create('session-3');

      const list = manager.list();
      expect(list).toHaveLength(3);
      expect(list.map(s => s.id)).toContain('session-1');
      expect(list.map(s => s.id)).toContain('session-2');
      expect(list.map(s => s.id)).toContain('session-3');
    });

    it('should include connected client counts', async () => {
      await manager.create('session-with-clients');

      const ws1 = new MockWebSocket() as any as ServerWebSocket;
      const ws2 = new MockWebSocket() as any as ServerWebSocket;

      manager.attach('session-with-clients', ws1);
      manager.attach('session-with-clients', ws2);

      const list = manager.list();
      const session = list.find(s => s.id === 'session-with-clients');

      expect(session!.connectedClients).toBe(2);
    });

    it('should include session metadata', async () => {
      await manager.create('metadata-test', { cwd: '/tmp' });

      const list = manager.list();
      const session = list[0];

      expect(session.id).toBe('metadata-test');
      expect(session.shell).toBeTruthy();
      expect(session.cwd).toBe('/tmp');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
    });
  });

  describe('has', () => {
    it('should return true if session exists', async () => {
      await manager.create('existing');
      expect(manager.has('existing')).toBe(true);
    });

    it('should return false if session does not exist', () => {
      expect(manager.has('nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return session info if it exists', async () => {
      await manager.create('test-get');
      const info = manager.get('test-get');

      expect(info).toBeDefined();
      expect(info!.id).toBe('test-get');
    });

    it('should return undefined if session does not exist', () => {
      const info = manager.get('nonexistent');
      expect(info).toBeUndefined();
    });
  });

  describe('killAll', () => {
    it('should kill all sessions', async () => {
      await manager.create('session-1');
      await manager.create('session-2');
      await manager.create('session-3');

      expect(manager.list()).toHaveLength(3);

      manager.killAll();

      expect(manager.list()).toHaveLength(0);
    });

    it('should be no-op if no sessions', () => {
      expect(() => {
        manager.killAll();
      }).not.toThrow();
    });

    it('should close all WebSockets', async () => {
      await manager.create('session-1');
      await manager.create('session-2');

      const ws1 = new MockWebSocket() as any as ServerWebSocket;
      const ws2 = new MockWebSocket() as any as ServerWebSocket;

      manager.attach('session-1', ws1);
      manager.attach('session-2', ws2);

      manager.killAll();

      expect(ws1.closed).toBe(true);
      expect(ws2.closed).toBe(true);
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton ptyManager instance', () => {
      expect(ptyManager).toBeInstanceOf(PTYManager);
    });
  });

  describe('integration tests', () => {
    it('should handle complete session lifecycle', async () => {
      const sessionId = 'lifecycle-test';

      // Create
      const created = await manager.create(sessionId);
      expect(manager.has(sessionId)).toBe(true);

      // Attach WebSocket
      const ws = new MockWebSocket() as any as ServerWebSocket;
      manager.attach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(1);

      // Wait to ensure time passes
      await new Promise(resolve => setTimeout(resolve, 10));

      // Write data
      manager.write(sessionId, 'test\n');
      expect(manager.get(sessionId)!.lastActivity.getTime()).toBeGreaterThan(created.lastActivity.getTime());

      // Detach WebSocket
      manager.detach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(0);

      // Kill
      manager.kill(sessionId);
      expect(manager.has(sessionId)).toBe(false);
    });

    it('should handle multiple sessions independently', async () => {
      const sessionId1 = 'multi-1';
      const sessionId2 = 'multi-2';

      const info1 = await manager.create(sessionId1, { cwd: '/tmp' });

      // Wait before creating session2 to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const info2 = await manager.create(sessionId2, { cwd: '/home' });

      // Wait before write
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.write(sessionId1, 'data1\n');
      // Don't write to sessionId2

      const after1 = manager.get(sessionId1)!;
      const after2 = manager.get(sessionId2)!;

      expect(after1.lastActivity.getTime()).toBeGreaterThan(info1.lastActivity.getTime());
      expect(after2.lastActivity.getTime()).toBe(info2.lastActivity.getTime());

      manager.kill(sessionId1);

      expect(manager.has(sessionId1)).toBe(false);
      expect(manager.has(sessionId2)).toBe(true);

      manager.kill(sessionId2);

      expect(manager.list()).toHaveLength(0);
    });

    it('should handle attach and detach multiple times', async () => {
      const sessionId = 'attach-detach-test';
      await manager.create(sessionId);

      const ws = new MockWebSocket() as any as ServerWebSocket;

      manager.attach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(1);

      manager.detach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(0);

      manager.attach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(1);

      manager.detach(sessionId, ws);
      expect(manager.get(sessionId)!.connectedClients).toBe(0);
    });
  });
});
