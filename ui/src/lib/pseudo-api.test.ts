/**
 * Pseudo API Client Tests
 *
 * Tests verify pseudo API methods:
 * - fetchPseudoFiles(project) - Fetch list of .pseudo files
 * - fetchPseudoFile(project, file) - Fetch contents of a .pseudo file
 * - searchPseudo(project, q) - Search across .pseudo files
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchPseudoFiles,
  fetchPseudoFile,
  searchPseudo,
  type SearchMatch,
  type SearchResult,
} from './pseudo-api';

// Mock fetch globally
global.fetch = vi.fn();

describe('Pseudo API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchPseudoFiles()', () => {
    it('should fetch list of pseudo files for a project', async () => {
      const mockFiles = ['utils.pseudo', 'api.pseudo', 'types.pseudo'];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: mockFiles }),
      });

      const result = await fetchPseudoFiles('/home/user/my-project');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/files?project=%2Fhome%2Fuser%2Fmy-project'
      );
      expect(result).toEqual(mockFiles);
      expect(result).toHaveLength(3);
    });

    it('should return empty array when no pseudo files exist', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      });

      const result = await fetchPseudoFiles('/home/user/empty-project');

      expect(result).toEqual([]);
    });

    it('should throw error on 404 status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Project not found' }),
      });

      await expect(fetchPseudoFiles('/nonexistent/project')).rejects.toThrow();
    });

    it('should throw error on 500 status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(fetchPseudoFiles('/home/user/project')).rejects.toThrow();
    });

    it('should throw error on network failure', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchPseudoFiles('/home/user/project')).rejects.toThrow(
        'Network error'
      );
    });

    it('should encode project path in query params', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ files: [] }),
      });

      await fetchPseudoFiles('/path with spaces & special chars');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/files?project=%2Fpath%20with%20spaces%20%26%20special%20chars'
      );
    });
  });

  describe('fetchPseudoFile()', () => {
    it('should fetch contents of a pseudo file', async () => {
      const mockContent = `function calculateSum(a: number, b: number): number
  return a + b`;

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: mockContent }),
      });

      const result = await fetchPseudoFile('/home/user/project', 'utils.pseudo');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/file?project=%2Fhome%2Fuser%2Fproject&file=utils.pseudo'
      );
      expect(result).toBe(mockContent);
    });

    it('should throw error when file not found (404)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'File not found' }),
      });

      await expect(fetchPseudoFile('/home/user/project', 'nonexistent.pseudo')).rejects.toThrow();
    });

    it('should throw error on 500 status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(fetchPseudoFile('/home/user/project', 'api.pseudo')).rejects.toThrow();
    });

    it('should throw error on network failure', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network timeout'));

      await expect(fetchPseudoFile('/home/user/project', 'utils.pseudo')).rejects.toThrow(
        'Network timeout'
      );
    });

    it('should encode both project and file in query params', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: '' }),
      });

      await fetchPseudoFile('/path with spaces', 'file with spaces.pseudo');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/file?project=%2Fpath%20with%20spaces&file=file%20with%20spaces.pseudo'
      );
    });

    it('should handle empty file content', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: '' }),
      });

      const result = await fetchPseudoFile('/home/user/project', 'empty.pseudo');

      expect(result).toBe('');
    });
  });

  describe('searchPseudo()', () => {
    it('should search across pseudo files with matches', async () => {
      const apiMatches: SearchMatch[] = [
        { functionName: 'fetchUser', line: 'async function fetchUser(id: number): Promise<User>', lineNumber: 5, isFunctionLine: true },
        { functionName: 'fetchUser', line: '  const user = await db.getUser(id)', lineNumber: 6, isFunctionLine: false },
      ];
      const utilsMatches: SearchMatch[] = [
        { functionName: 'validateUser', line: '  if (!user.id) throw new Error("Invalid user")', lineNumber: 12, isFunctionLine: false },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ matches: { 'api.pseudo': apiMatches, 'utils.pseudo': utilsMatches } }),
      });

      const result = await searchPseudo('/home/user/project', 'user');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/search?project=%2Fhome%2Fuser%2Fproject&q=user'
      );
      expect(result).toHaveLength(2);
      expect(result[0].file).toBe('api.pseudo');
      expect(result[0].matches).toHaveLength(2);
      expect(result[1].file).toBe('utils.pseudo');
      expect(result[1].matches).toHaveLength(1);
    });

    it('should return empty array when no matches found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      const result = await searchPseudo('/home/user/project', 'nonexistent');

      expect(result).toEqual([]);
    });

    it('should throw error on 404 project not found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Project not found' }),
      });

      await expect(searchPseudo('/nonexistent/project', 'search')).rejects.toThrow();
    });

    it('should throw error on 500 status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      await expect(searchPseudo('/home/user/project', 'query')).rejects.toThrow();
    });

    it('should throw error on network failure', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(searchPseudo('/home/user/project', 'search')).rejects.toThrow(
        'Connection refused'
      );
    });

    it('should encode both project and query in query params', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      });

      await searchPseudo('/path with spaces', 'query with special chars & stuff');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/search?project=%2Fpath%20with%20spaces&q=query%20with%20special%20chars%20%26%20stuff'
      );
    });

    it('should handle SearchMatch with complete type information', async () => {
      const typeMatch: SearchMatch = {
        functionName: 'User',
        line: 'type User = { id: number, name: string }',
        lineNumber: 1,
        isFunctionLine: true,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ matches: { 'types.pseudo': [typeMatch] } }),
      });

      const result = await searchPseudo('/home/user/project', 'User');

      const match = result[0].matches[0];
      expect(match.functionName).toBe('User');
      expect(match.line).toBe('type User = { id: number, name: string }');
      expect(match.lineNumber).toBe(1);
    });
  });
});
