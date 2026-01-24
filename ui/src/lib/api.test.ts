/**
 * API Client Tests
 *
 * Tests verify terminal session API methods:
 * - getTerminalSessions - Fetch all sessions
 * - createTerminalSession - Create new session
 * - deleteTerminalSession - Delete session
 * - renameTerminalSession - Rename session
 * - reorderTerminalSessions - Reorder sessions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from './api';
import type { TerminalSession, CreateSessionResult } from '@/types/terminal';

// Mock fetch globally
global.fetch = vi.fn();

describe('API Client - Terminal Session Methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getTerminalSessions', () => {
    it('should fetch terminal sessions for a collab session', async () => {
      const mockSessions: TerminalSession[] = [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-test-a1b2',
          created: '2025-01-24T10:00:00Z',
          order: 0,
        },
        {
          id: 'session-2',
          name: 'Terminal 2',
          tmuxSession: 'mc-test-c3d4',
          created: '2025-01-24T10:05:00Z',
          order: 1,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: mockSessions }),
      });

      const result = await api.getTerminalSessions('/project/path', 'test-session');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/sessions?project=%2Fproject%2Fpath&session=test-session'
      );
      expect(result).toEqual(mockSessions);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-1');
      expect(result[1].id).toBe('session-2');
    });

    it('should return empty array when no sessions exist', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: [] }),
      });

      const result = await api.getTerminalSessions('/project/path', 'test-session');

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should handle missing sessions field in response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await api.getTerminalSessions('/project/path', 'test-session');

      expect(result).toEqual([]);
    });

    it('should encode URL parameters correctly', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: [] }),
      });

      await api.getTerminalSessions('/path with spaces', 'session-name');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/sessions?project=%2Fpath%20with%20spaces&session=session-name'
      );
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(api.getTerminalSessions('/project/path', 'test-session')).rejects.toThrow(
        'Internal Server Error'
      );
    });
  });

  describe('createTerminalSession', () => {
    it('should create a new terminal session', async () => {
      const mockResult: CreateSessionResult = {
        id: 'session-3',
        tmuxSession: 'mc-test-e5f6',
        wsUrl: 'ws://localhost:3737/terminal/e5f6',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const result = await api.createTerminalSession('/project/path', 'test-session', 'My Terminal');

      expect(global.fetch).toHaveBeenCalledWith('/api/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: '/project/path',
          session: 'test-session',
          name: 'My Terminal',
        }),
      });
      expect(result).toEqual(mockResult);
      expect(result.id).toBe('session-3');
      expect(result.wsUrl).toBeDefined();
    });

    it('should create session without optional name parameter', async () => {
      const mockResult: CreateSessionResult = {
        id: 'session-4',
        tmuxSession: 'mc-test-g7h8',
        wsUrl: 'ws://localhost:3737/terminal/g7h8',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const result = await api.createTerminalSession('/project/path', 'test-session');

      expect(global.fetch).toHaveBeenCalledWith('/api/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: '/project/path',
          session: 'test-session',
          name: undefined,
        }),
      });
      expect(result.id).toBe('session-4');
    });

    it('should use correct HTTP method and headers', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'session-5',
          tmuxSession: 'mc-test-i9j0',
          wsUrl: 'ws://localhost:3737/terminal/i9j0',
        }),
      });

      await api.createTerminalSession('/project/path', 'test-session');

      const call = (global.fetch as any).mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      });

      await expect(api.createTerminalSession('/project/path', 'test-session')).rejects.toThrow(
        'Bad Request'
      );
    });
  });

  describe('deleteTerminalSession', () => {
    it('should delete a terminal session', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.deleteTerminalSession('/project/path', 'test-session', 'session-1');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/sessions/session-1?project=%2Fproject%2Fpath&session=test-session',
        { method: 'DELETE' }
      );
    });

    it('should encode session ID in URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.deleteTerminalSession('/project/path', 'test-session', 'session-with-special/chars');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('session-with-special%2Fchars'),
        { method: 'DELETE' }
      );
    });

    it('should encode project and session in query parameters', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.deleteTerminalSession('/path with spaces', 'session name', 'id');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/sessions/id?project=%2Fpath%20with%20spaces&session=session%20name',
        { method: 'DELETE' }
      );
    });

    it('should use DELETE HTTP method', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.deleteTerminalSession('/project/path', 'test-session', 'session-1');

      const call = (global.fetch as any).mock.calls[0];
      expect(call[1].method).toBe('DELETE');
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(
        api.deleteTerminalSession('/project/path', 'test-session', 'session-1')
      ).rejects.toThrow('Not Found');
    });

    it('should not return any value on success', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      const result = await api.deleteTerminalSession('/project/path', 'test-session', 'session-1');

      expect(result).toBeUndefined();
    });
  });

  describe('renameTerminalSession', () => {
    it('should rename a terminal session', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.renameTerminalSession('/project/path', 'test-session', 'session-1', 'New Name');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/sessions/session-1?project=%2Fproject%2Fpath&session=test-session',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        }
      );
    });

    it('should handle names with special characters', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.renameTerminalSession('/project/path', 'test-session', 'session-1', 'Terminal (dev)');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.name).toBe('Terminal (dev)');
    });

    it('should use PATCH HTTP method', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.renameTerminalSession('/project/path', 'test-session', 'session-1', 'New Name');

      const call = (global.fetch as any).mock.calls[0];
      expect(call[1].method).toBe('PATCH');
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });

    it('should encode URL parameters correctly', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.renameTerminalSession('/path with spaces', 'session/name', 'id-123', 'New Name');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('%2Fpath%20with%20spaces'),
        expect.any(Object)
      );
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Conflict',
      });

      await expect(
        api.renameTerminalSession('/project/path', 'test-session', 'session-1', 'New Name')
      ).rejects.toThrow('Conflict');
    });

    it('should not return any value on success', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      const result = await api.renameTerminalSession(
        '/project/path',
        'test-session',
        'session-1',
        'New Name'
      );

      expect(result).toBeUndefined();
    });
  });

  describe('reorderTerminalSessions', () => {
    it('should reorder terminal sessions', async () => {
      const orderedIds = ['session-2', 'session-1', 'session-3'];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.reorderTerminalSessions('/project/path', 'test-session', orderedIds);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/sessions/reorder?project=%2Fproject%2Fpath&session=test-session',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds }),
        }
      );
    });

    it('should handle empty order list', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.reorderTerminalSessions('/project/path', 'test-session', []);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.orderedIds).toEqual([]);
    });

    it('should handle single session', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.reorderTerminalSessions('/project/path', 'test-session', ['session-1']);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.orderedIds).toEqual(['session-1']);
    });

    it('should use PUT HTTP method', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.reorderTerminalSessions('/project/path', 'test-session', ['session-1']);

      const call = (global.fetch as any).mock.calls[0];
      expect(call[1].method).toBe('PUT');
      expect(call[1].headers['Content-Type']).toBe('application/json');
    });

    it('should encode URL parameters correctly', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.reorderTerminalSessions('/path with spaces', 'session/name', ['id']);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('%2Fpath%20with%20spaces'),
        expect.any(Object)
      );
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Unprocessable Entity',
      });

      await expect(
        api.reorderTerminalSessions('/project/path', 'test-session', ['session-1'])
      ).rejects.toThrow('Unprocessable Entity');
    });

    it('should not return any value on success', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      const result = await api.reorderTerminalSessions('/project/path', 'test-session', [
        'session-1',
      ]);

      expect(result).toBeUndefined();
    });

    it('should preserve order of session IDs', async () => {
      const orderedIds = ['z', 'a', 'm', 'b'];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await api.reorderTerminalSessions('/project/path', 'test-session', orderedIds);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.orderedIds).toEqual(['z', 'a', 'm', 'b']);
    });
  });

  describe('Integration Tests', () => {
    it('should handle multiple sequential calls', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessions: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'session-1',
            tmuxSession: 'mc-test-a1b2',
            wsUrl: 'ws://localhost:3737/terminal/a1b2',
          }),
        });

      await api.getTerminalSessions('/project/path', 'test-session');
      const created = await api.createTerminalSession('/project/path', 'test-session');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(created.id).toBe('session-1');
    });

    it('should handle error recovery', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessions: [] }),
        });

      // First call fails
      await expect(api.getTerminalSessions('/project/path', 'test-session')).rejects.toThrow(
        'Server Error'
      );

      // Second call succeeds
      const result = await api.getTerminalSessions('/project/path', 'test-session');
      expect(result).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should throw error with status text on fetch failure', async () => {
      const errorMessage = 'Unauthorized';
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: errorMessage,
      });

      await expect(api.getTerminalSessions('/project/path', 'test-session')).rejects.toThrow(
        errorMessage
      );
    });

    it('should handle various HTTP status codes', async () => {
      const statusTexts = ['Bad Request', 'Unauthorized', 'Forbidden', 'Not Found', 'Server Error'];

      for (const statusText of statusTexts) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: false,
          statusText,
        });

        await expect(api.getTerminalSessions('/project/path', 'test-session')).rejects.toThrow(
          statusText
        );
      }
    });
  });
});
