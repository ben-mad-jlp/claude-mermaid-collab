import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../api';

// Mock fetch globally
global.fetch = vi.fn();

describe('API Client - Snippet Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSnippet', () => {
    it('should send POST request with correct parameters', async () => {
      const mockResponse = { id: 'test-id', success: true };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await api.createSnippet(
        '/test/project',
        'test-session',
        'my-snippet',
        'console.log("test");'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/snippet'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(result).toEqual(mockResponse);
    });

    it('should encode project and session in URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'test', success: true }),
      });

      await api.createSnippet(
        '/path/with spaces',
        'session-name',
        'snippet',
        'content'
      );

      const callUrl = (global.fetch as any).mock.calls[0][0];
      // URL parameters should be encoded (spaces become %20, slashes become %2F)
      expect(callUrl).toContain('%2F'); // Encoded /
      expect(callUrl).toContain('%20'); // Encoded space
      expect(callUrl).toContain('project=');
      expect(callUrl).toContain('session=');
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      });

      await expect(
        api.createSnippet('/project', 'session', 'name', 'content')
      ).rejects.toThrow('Bad Request');
    });
  });

  describe('getSnippets', () => {
    it('should fetch snippets for a session', async () => {
      const mockSnippets = [
        { id: 'snippet1', name: 'snippet1', content: 'code', lastModified: Date.now() },
        { id: 'snippet2', name: 'snippet2', content: 'more code', lastModified: Date.now() },
      ];
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ snippets: mockSnippets }),
      });

      const result = await api.getSnippets('/test/project', 'test-session');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/snippets')
      );
      expect(result).toEqual(mockSnippets);
    });

    it('should return empty array if no snippets', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await api.getSnippets('/test/project', 'test-session');

      expect(result).toEqual([]);
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(
        api.getSnippets('/project', 'session')
      ).rejects.toThrow('Not Found');
    });
  });

  describe('getSnippet', () => {
    it('should fetch a single snippet by id', async () => {
      const mockSnippet = {
        id: 'my-snippet',
        name: 'my-snippet',
        content: 'console.log("test");',
        lastModified: Date.now(),
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSnippet,
      });

      const result = await api.getSnippet('/test/project', 'test-session', 'my-snippet');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/snippet/my-snippet')
      );
      expect(result).toEqual(mockSnippet);
    });

    it('should return null for 404 response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 404,
      });

      const result = await api.getSnippet('/test/project', 'test-session', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should encode snippet id in URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 404,
      });

      await api.getSnippet('/project', 'session', 'id with spaces');

      const callUrl = (global.fetch as any).mock.calls[0][0];
      // ID with spaces should be encoded
      expect(callUrl).toContain('%20'); // Encoded space
    });

    it('should throw error on other failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(
        api.getSnippet('/project', 'session', 'id')
      ).rejects.toThrow('Internal Server Error');
    });
  });

  describe('updateSnippet', () => {
    it('should send POST request with updated content', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await api.updateSnippet(
        '/test/project',
        'test-session',
        'snippet-id',
        'updated content'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/snippet/snippet-id'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should include content in request body', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await api.updateSnippet('/project', 'session', 'id', 'new content');

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.content).toBe('new content');
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(
        api.updateSnippet('/project', 'session', 'id', 'content')
      ).rejects.toThrow('Not Found');
    });
  });

  describe('deleteSnippet', () => {
    it('should send DELETE request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await api.deleteSnippet('/test/project', 'test-session', 'snippet-id');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/snippet/snippet-id'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should encode snippet id in URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await api.deleteSnippet('/project', 'session', 'id with spaces');

      const callUrl = (global.fetch as any).mock.calls[0][0];
      // ID with spaces should be encoded
      expect(callUrl).toContain('%20'); // Encoded space
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(
        api.deleteSnippet('/project', 'session', 'id')
      ).rejects.toThrow('Not Found');
    });
  });
});
