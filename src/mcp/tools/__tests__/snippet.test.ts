import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleCreateSnippet,
  handleUpdateSnippet,
  handleGetSnippet,
  handleListSnippets,
  handleDeleteSnippet,
  handleExportSnippet,
  createSnippetSchema,
  updateSnippetSchema,
  getSnippetSchema,
  listSnippetsSchema,
  deleteSnippetSchema,
  exportSnippetSchema,
} from '../snippet';

// Mock fetch globally
global.fetch = vi.fn();

const mockFetch = global.fetch as any;

describe('Snippet MCP Tools', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    mockFetch.mockClear();
  });

  describe('Schemas', () => {
    it('should have valid createSnippetSchema', () => {
      expect(createSnippetSchema.type).toBe('object');
      expect(createSnippetSchema.required).toContain('project');
      // name and content are optional — sourcePath can substitute for both
    });

    it('should have valid updateSnippetSchema', () => {
      expect(updateSnippetSchema.type).toBe('object');
      expect(updateSnippetSchema.required).toContain('project');
      expect(updateSnippetSchema.required).toContain('id');
      expect(updateSnippetSchema.required).toContain('content');
    });

    it('should have valid getSnippetSchema', () => {
      expect(getSnippetSchema.type).toBe('object');
      expect(getSnippetSchema.required).toContain('project');
      expect(getSnippetSchema.required).toContain('id');
    });

    it('should have valid listSnippetsSchema', () => {
      expect(listSnippetsSchema.type).toBe('object');
      expect(listSnippetsSchema.required).toContain('project');
      expect(listSnippetsSchema.required).toContain('session');
    });

    it('should have valid deleteSnippetSchema', () => {
      expect(deleteSnippetSchema.type).toBe('object');
      expect(deleteSnippetSchema.required).toContain('project');
      expect(deleteSnippetSchema.required).toContain('id');
    });

    it('should have valid exportSnippetSchema', () => {
      expect(exportSnippetSchema.type).toBe('object');
      expect(exportSnippetSchema.required).toContain('project');
      expect(exportSnippetSchema.required).toContain('id');
    });
  });

  describe('handleCreateSnippet', () => {
    it('should create a snippet successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'my-snippet', success: true }),
      });

      const result = await handleCreateSnippet(
        '/Users/test/project',
        'my-session',
        'mySnippet',
        'console.log("hello");'
      );

      expect(result).toEqual({ success: true, id: 'my-snippet' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('/api/snippet');
    });

    it('should handle creation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Invalid snippet name' }),
      });

      await expect(
        handleCreateSnippet('/Users/test/project', 'my-session', 'bad@name', 'content')
      ).rejects.toThrow('Failed to create snippet');
    });
  });

  describe('handleGetSnippet', () => {
    it('should get a snippet successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'my-snippet',
          name: 'mySnippet',
          content: 'console.log("hello");',
          lastModified: Date.now(),
        }),
      });

      const result = await handleGetSnippet('/Users/test/project', 'my-session', 'my-snippet');

      expect(result).toHaveProperty('id', 'my-snippet');
      expect(result).toHaveProperty('name', 'mySnippet');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('lastModified');
    });

    it('should handle not found errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      await expect(
        handleGetSnippet('/Users/test/project', 'my-session', 'nonexistent')
      ).rejects.toThrow('Snippet not found');
    });
  });

  describe('handleListSnippets', () => {
    it('should list all snippets', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          snippets: [
            { id: 'snippet-1', name: 'snippet-1', lastModified: 1000 },
            { id: 'snippet-2', name: 'snippet-2', lastModified: 2000 },
          ],
        }),
      });

      const result = await handleListSnippets('/Users/test/project', 'my-session');

      expect(result.snippets).toHaveLength(2);
      expect(result.snippets[0]).toHaveProperty('id');
      expect(result.snippets[0]).toHaveProperty('name');
    });

    it('should handle empty snippet list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ snippets: [] }),
      });

      const result = await handleListSnippets('/Users/test/project', 'my-session');

      expect(result.snippets).toHaveLength(0);
    });

    it('should handle list errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      await expect(
        handleListSnippets('/Users/test/project', 'my-session')
      ).rejects.toThrow('Failed to list snippets');
    });
  });

  describe('handleUpdateSnippet', () => {
    it('should update a snippet successfully', async () => {
      // First call: GET existing snippet (for envelope merge)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'my-snippet', name: 'my-snippet', content: JSON.stringify({ code: 'old code', language: 'typescript', originalCode: 'old code' }) }),
      });
      // Second call: POST update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await handleUpdateSnippet(
        '/Users/test/project',
        'my-session',
        'my-snippet',
        'console.log("updated");'
      );

      expect(result).toEqual({ success: true, id: 'my-snippet' });
    });

    it('should preserve JSON envelope and reset originalCode on update', async () => {
      const existing = { code: 'old', language: 'typescript', filePath: '/src/foo.ts', originalCode: 'old' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 's', name: 's', content: JSON.stringify(existing) }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await handleUpdateSnippet('/Users/test/project', 'my-session', 's', 'new code');

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse(postCall[1].body);
      const saved = JSON.parse(body.content);
      expect(saved.code).toBe('new code');
      expect(saved.originalCode).toBe('new code');
      expect(saved.language).toBe('typescript');
      expect(saved.filePath).toBe('/src/foo.ts');
    });

    it('should handle update errors', async () => {
      // GET succeeds, POST fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'nonexistent', content: 'raw' }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Snippet not found' }),
      });

      await expect(
        handleUpdateSnippet('/Users/test/project', 'my-session', 'nonexistent', 'content')
      ).rejects.toThrow('Failed to update snippet');
    });
  });

  describe('handleDeleteSnippet', () => {
    it('should delete a snippet successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await handleDeleteSnippet('/Users/test/project', 'my-session', 'my-snippet');

      expect(result).toEqual({ success: true });
      expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    });

    it('should handle deletion errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Snippet not found' }),
      });

      await expect(
        handleDeleteSnippet('/Users/test/project', 'my-session', 'nonexistent')
      ).rejects.toThrow('Failed to delete snippet');
    });
  });

  describe('handleExportSnippet', () => {
    it('should export snippet as text', async () => {
      const testContent = 'console.log("hello");';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'my-snippet',
          name: 'mySnippet',
          content: testContent,
          lastModified: Date.now(),
        }),
      });

      const result = await handleExportSnippet(
        '/Users/test/project',
        'my-session',
        'my-snippet',
        'text'
      );

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('format', 'text');
    });

    it('should export snippet as json', async () => {
      const testContent = 'console.log("hello");';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'my-snippet',
          name: 'mySnippet',
          content: testContent,
          lastModified: Date.now(),
        }),
      });

      const result = await handleExportSnippet(
        '/Users/test/project',
        'my-session',
        'my-snippet',
        'json'
      );

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('format', 'json');
    });

    it('should handle export errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      await expect(
        handleExportSnippet('/Users/test/project', 'my-session', 'nonexistent', 'text')
      ).rejects.toThrow();
    });
  });
});
