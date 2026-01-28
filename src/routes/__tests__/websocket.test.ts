/**
 * Tests for WebSocket terminal handler
 * Tests message protocol, lifecycle, and error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleTerminalOpen,
  handleTerminalMessage,
  handleTerminalClose,
  handleTerminalError,
} from '../websocket';
import type { ServerWebSocket } from 'bun';

// Mock PTYManager
vi.mock('../../terminal/index', () => ({
  ptyManager: {
    attach: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    detach: vi.fn(),
  },
}));

import { ptyManager } from '../../terminal/index';

describe('Terminal WebSocket Handler', () => {
  let mockWs: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock WebSocket
    // Session ID is now set by server.ts during upgrade, passed via ws.data.sessionId
    mockWs = {
      data: { type: 'terminal', sessionId: 'test-session' },
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1, // OPEN
    } as any as ServerWebSocket;
  });

  describe('handleTerminalOpen()', () => {
    it('should use session ID from ws.data and attach to PTYManager with deferReplay', () => {
      mockWs.data.sessionId = 'my-session-123';

      handleTerminalOpen(mockWs);

      expect(ptyManager.attach).toHaveBeenCalledWith('my-session-123', mockWs, { deferReplay: true });
    });

    it('should handle session ID with special characters', () => {
      mockWs.data.sessionId = 'session-with-dash_and_underscore';

      handleTerminalOpen(mockWs);

      expect(ptyManager.attach).toHaveBeenCalledWith('session-with-dash_and_underscore', mockWs, { deferReplay: true });
    });

    it('should reject missing session ID', () => {
      mockWs.data.sessionId = '';

      handleTerminalOpen(mockWs);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Missing or invalid session ID',
        })
      );
      expect(mockWs.close).toHaveBeenCalled();
      expect(ptyManager.attach).not.toHaveBeenCalled();
    });

    it('should reject undefined session ID', () => {
      mockWs.data.sessionId = undefined;

      handleTerminalOpen(mockWs);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Missing or invalid session ID',
        })
      );
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('should handle attach() errors gracefully', () => {
      mockWs.data.sessionId = 'error-session';
      (ptyManager.attach as any).mockImplementation(() => {
        throw new Error('Failed to create session');
      });

      handleTerminalOpen(mockWs);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Failed to connect to session: Failed to create session',
        })
      );
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('handleTerminalMessage()', () => {
    beforeEach(() => {
      mockWs.data.sessionId = 'test-session';
    });

    it('should handle input message', () => {
      const message = JSON.stringify({ type: 'input', data: 'ls -la\n' });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.write).toHaveBeenCalledWith('test-session', 'ls -la\n');
    });

    it('should handle resize message without isInitial flag', () => {
      const message = JSON.stringify({ type: 'resize', cols: 120, rows: 40 });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.resize).toHaveBeenCalledWith('test-session', 120, 40);
    });

    it('should handle resize message with isInitial flag set to true', () => {
      const message = JSON.stringify({ type: 'resize', cols: 120, rows: 40, isInitial: true });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.resize).toHaveBeenCalledWith('test-session', 120, 40);
    });

    it('should handle resize message with isInitial flag set to false', () => {
      const message = JSON.stringify({ type: 'resize', cols: 100, rows: 30, isInitial: false });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.resize).toHaveBeenCalledWith('test-session', 100, 30);
    });

    it('should handle input as Buffer', () => {
      const message = Buffer.from(JSON.stringify({ type: 'input', data: 'echo test' }));

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.write).toHaveBeenCalledWith('test-session', 'echo test');
    });

    it('should reject invalid JSON', () => {
      const message = 'not json {invalid}';

      handleTerminalMessage(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
        })
      );
      expect(ptyManager.write).not.toHaveBeenCalled();
    });

    it('should reject unknown message type', () => {
      const message = JSON.stringify({ type: 'unknown', data: 'test' });

      handleTerminalMessage(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Unknown message type: unknown',
        })
      );
    });

    it('should validate input message has data string', () => {
      const message = JSON.stringify({ type: 'input', data: 123 });

      handleTerminalMessage(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Invalid input message: data must be a string',
        })
      );
    });

    it('should validate resize message has numeric cols and rows', () => {
      const message = JSON.stringify({ type: 'resize', cols: 'abc', rows: 40 });

      handleTerminalMessage(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Invalid resize message: cols and rows must be numbers',
        })
      );
    });

    it('should handle ptyManager.write() errors', () => {
      (ptyManager.write as any).mockImplementation(() => {
        throw new Error('Session not found');
      });

      const message = JSON.stringify({ type: 'input', data: 'test' });

      handleTerminalMessage(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Session not found',
        })
      );
    });

    it('should reject message with no session ID', () => {
      mockWs.data.sessionId = '';

      const message = JSON.stringify({ type: 'input', data: 'test' });

      handleTerminalMessage(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'error',
          message: 'Session ID not initialized',
        })
      );
    });
  });

  describe('handleTerminalClose()', () => {
    beforeEach(() => {
      mockWs.data.sessionId = 'test-session';
    });

    it('should detach from PTYManager', () => {
      handleTerminalClose(mockWs);

      expect(ptyManager.detach).toHaveBeenCalledWith('test-session', mockWs);
    });

    it('should be safe if no session ID', () => {
      mockWs.data.sessionId = '';

      expect(() => handleTerminalClose(mockWs)).not.toThrow();
      expect(ptyManager.detach).not.toHaveBeenCalled();
    });
  });

  describe('handleTerminalError()', () => {
    beforeEach(() => {
      mockWs.data.sessionId = 'test-session';
    });

    it('should detach from PTYManager on error', () => {
      const error = new Error('WebSocket error');

      handleTerminalError(mockWs, error);

      expect(ptyManager.detach).toHaveBeenCalledWith('test-session', mockWs);
    });

    it('should handle detach errors gracefully', () => {
      (ptyManager.detach as any).mockImplementation(() => {
        throw new Error('Detach failed');
      });

      const error = new Error('WebSocket error');

      expect(() => handleTerminalError(mockWs, error)).not.toThrow();
    });

    it('should be safe if no session ID', () => {
      mockWs.data.sessionId = '';
      const error = new Error('WebSocket error');

      expect(() => handleTerminalError(mockWs, error)).not.toThrow();
      expect(ptyManager.detach).not.toHaveBeenCalled();
    });
  });

  describe('Message Protocol', () => {
    beforeEach(() => {
      mockWs.data.sessionId = 'test-session';
    });

    it('should support empty input', () => {
      const message = JSON.stringify({ type: 'input', data: '' });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.write).toHaveBeenCalledWith('test-session', '');
    });

    it('should support newlines in input', () => {
      const message = JSON.stringify({ type: 'input', data: 'line1\nline2\nline3' });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.write).toHaveBeenCalledWith('test-session', 'line1\nline2\nline3');
    });

    it('should support binary data in input (as base64 or similar)', () => {
      // NOTE: Current implementation expects string data
      const message = JSON.stringify({ type: 'input', data: 'test\u0000binary' });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.write).toHaveBeenCalledWith('test-session', 'test\u0000binary');
    });

    it('should support large resize values', () => {
      const message = JSON.stringify({ type: 'resize', cols: 1000, rows: 500 });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.resize).toHaveBeenCalledWith('test-session', 1000, 500);
    });

    it('should support minimum resize values', () => {
      const message = JSON.stringify({ type: 'resize', cols: 1, rows: 1 });

      handleTerminalMessage(mockWs, message);

      expect(ptyManager.resize).toHaveBeenCalledWith('test-session', 1, 1);
    });
  });
});
