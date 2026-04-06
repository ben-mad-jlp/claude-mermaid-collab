/**
 * Pseudo API Client Tests
 *
 * Tests verify pseudo API methods:
 * - fetchPseudoFiles(project) - Fetch list of .pseudo files (returns PseudoFileSummary[])
 * - fetchPseudoFile(project, file) - Fetch contents of a .pseudo file (returns PseudoFileWithMethods)
 * - searchPseudo(project, q) - Search across .pseudo files (returns SearchResult[])
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchPseudoFiles,
  fetchPseudoFile,
  searchPseudo,
  type SearchResult,
  type PseudoFileSummary,
  type PseudoFileWithMethods,
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
      const mockFiles: PseudoFileSummary[] = [
        { filePath: 'utils.pseudo', title: 'Utils', methodCount: 3, exportCount: 1, lastUpdated: '2026-01-01' },
        { filePath: 'api.pseudo', title: 'API', methodCount: 5, exportCount: 2, lastUpdated: '2026-01-01' },
        { filePath: 'types.pseudo', title: 'Types', methodCount: 2, exportCount: 0, lastUpdated: '2026-01-01' },
      ];

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
      const mockData: PseudoFileWithMethods = {
        filePath: 'utils.pseudo',
        title: 'Utils',
        purpose: 'Utility functions',
        moduleContext: '',
        syncedAt: null,
        methods: [
          {
            name: 'calculateSum',
            params: 'a: number, b: number',
            returnType: 'number',
            isExported: true,
            date: null,
            steps: [{ content: 'return a + b', depth: 0 }],
            calls: [],
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

      const result = await fetchPseudoFile('/home/user/project', 'utils.pseudo');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/file?project=%2Fhome%2Fuser%2Fproject&file=utils.pseudo'
      );
      expect(result).toEqual(mockData);
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
      const mockData: PseudoFileWithMethods = {
        filePath: 'file with spaces.pseudo',
        title: 'File',
        purpose: '',
        moduleContext: '',
        syncedAt: null,
        methods: [],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

      await fetchPseudoFile('/path with spaces', 'file with spaces.pseudo');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/file?project=%2Fpath%20with%20spaces&file=file%20with%20spaces.pseudo'
      );
    });

    it('should handle empty methods list', async () => {
      const mockData: PseudoFileWithMethods = {
        filePath: 'empty.pseudo',
        title: 'Empty',
        purpose: '',
        moduleContext: '',
        syncedAt: null,
        methods: [],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

      const result = await fetchPseudoFile('/home/user/project', 'empty.pseudo');

      expect(result.methods).toEqual([]);
    });
  });

  describe('searchPseudo()', () => {
    it('should search across pseudo files with matches', async () => {
      const mockResults: SearchResult[] = [
        { filePath: 'api.pseudo', methodName: 'fetchUser', snippet: 'async function fetchUser(id: number): Promise<User>', rank: 1 },
        { filePath: 'api.pseudo', methodName: 'fetchUser', snippet: '  const user = await db.getUser(id)', rank: 2 },
        { filePath: 'utils.pseudo', methodName: 'validateUser', snippet: '  if (!user.id) throw new Error("Invalid user")', rank: 3 },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ matches: mockResults }),
      });

      const result = await searchPseudo('/home/user/project', 'user');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/search?project=%2Fhome%2Fuser%2Fproject&q=user'
      );
      expect(result).toHaveLength(3);
      expect(result[0].filePath).toBe('api.pseudo');
      expect(result[0].methodName).toBe('fetchUser');
      expect(result[2].filePath).toBe('utils.pseudo');
      expect(result[2].methodName).toBe('validateUser');
    });

    it('should return empty array when no matches found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ matches: [] }),
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
        json: async () => ({ matches: [] }),
      });

      await searchPseudo('/path with spaces', 'query with special chars & stuff');

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pseudo/search?project=%2Fpath%20with%20spaces&q=query%20with%20special%20chars%20%26%20stuff'
      );
    });

    it('should handle SearchResult with complete type information', async () => {
      const mockResult: SearchResult = {
        filePath: 'types.pseudo',
        methodName: 'User',
        snippet: 'type User = { id: number, name: string }',
        rank: 1,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ matches: [mockResult] }),
      });

      const result = await searchPseudo('/home/user/project', 'User');

      expect(result[0].methodName).toBe('User');
      expect(result[0].snippet).toBe('type User = { id: number, name: string }');
      expect(result[0].filePath).toBe('types.pseudo');
    });
  });
});
