/**
 * Kodex API Tests
 *
 * Tests verify:
 * - listTopicsWithContent successfully fetches topics with content
 * - addAlias successfully sends POST request
 * - removeAlias successfully sends DELETE request
 * - Error handling for failed requests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { kodexApi, Topic } from '../kodex-api';

// Mock fetch globally
global.fetch = vi.fn();

describe('kodexApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTopicsWithContent', () => {
    it('should successfully fetch topics with content', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const mockTopics: Topic[] = [
        {
          name: 'topic-1',
          title: 'Topic 1',
          confidence: 'high',
          verified: true,
          verifiedAt: '2025-01-01T00:00:00Z',
          verifiedBy: 'user1',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          hasDraft: false,
          content: {
            conceptual: 'Conceptual overview',
            technical: 'Technical details',
            files: 'src/file.ts',
            related: 'topic-2',
          },
        },
        {
          name: 'topic-2',
          title: 'Topic 2',
          confidence: 'medium',
          verified: false,
          verifiedAt: null,
          verifiedBy: null,
          createdAt: '2025-01-02T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          hasDraft: true,
          content: {
            conceptual: 'Another overview',
            technical: 'More technical info',
            files: 'src/another.ts',
            related: 'topic-1',
          },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTopics,
      } as Response);

      const project = 'test-project';
      const result = await kodexApi.listTopicsWithContent(project);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];

      expect(url).toContain('/api/kodex/topics');
      expect(url).toContain('project=test-project');
      expect(url).toContain('includeContent=true');

      expect(result).toEqual(mockTopics);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBeDefined();
      expect(result[1].content).toBeDefined();
    });

    it('should handle missing includeContent parameter by adding it', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      const project = 'test-project';
      await kodexApi.listTopicsWithContent(project);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];

      // Verify includeContent parameter is included
      expect(url).toContain('includeContent=true');
    });

    it('should throw error on failed request', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      const project = 'test-project';

      await expect(kodexApi.listTopicsWithContent(project)).rejects.toThrow(
        'Failed to list topics with content'
      );
    });

    it('should handle network errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const project = 'test-project';

      await expect(kodexApi.listTopicsWithContent(project)).rejects.toThrow(
        'Network error'
      );
    });

    it('should return correctly typed Topic array', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const mockTopics: Topic[] = [
        {
          name: 'test',
          title: 'Test',
          confidence: 'high',
          verified: true,
          verifiedAt: '2025-01-01T00:00:00Z',
          verifiedBy: 'user1',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
          hasDraft: false,
          content: {
            conceptual: 'test',
            technical: 'test',
            files: 'test',
            related: 'test',
          },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTopics,
      } as Response);

      const result = await kodexApi.listTopicsWithContent('test-project');

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('content');
      expect(result[0].content).toHaveProperty('conceptual');
      expect(result[0].content).toHaveProperty('technical');
      expect(result[0].content).toHaveProperty('files');
      expect(result[0].content).toHaveProperty('related');
    });
  });
});

describe('kodexApi - Alias Methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addAlias', () => {
    it('should successfully send POST request to add alias', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const project = 'test-project';
      const topicId = 'test-topic';
      const alias = 'test-alias';

      await kodexApi.addAlias(project, topicId, alias);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];

      // Verify URL contains correct path
      expect(url).toContain('/api/kodex/topics/test-topic/alias');
      expect(url).toContain('project=test-project');

      // Verify method and headers
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });

      // Verify body contains alias
      const body = JSON.parse(options?.body as string);
      expect(body.alias).toBe(alias);
    });

    it('should throw error on failed POST request', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      const project = 'test-project';
      const topicId = 'test-topic';
      const alias = 'test-alias';

      await expect(kodexApi.addAlias(project, topicId, alias)).rejects.toThrow(
        'Failed to add alias'
      );
    });

    it('should handle network errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const project = 'test-project';
      const topicId = 'test-topic';
      const alias = 'test-alias';

      await expect(kodexApi.addAlias(project, topicId, alias)).rejects.toThrow(
        'Network error'
      );
    });
  });

  describe('removeAlias', () => {
    it('should successfully send DELETE request to remove alias', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      const project = 'test-project';
      const topicId = 'test-topic';
      const alias = 'test-alias';

      await kodexApi.removeAlias(project, topicId, alias);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];

      // Verify URL contains correct path
      expect(url).toContain('/api/kodex/topics/test-topic/alias');
      expect(url).toContain('project=test-project');

      // Verify method
      expect(options?.method).toBe('DELETE');

      // Verify body contains alias
      const body = JSON.parse(options?.body as string);
      expect(body.alias).toBe(alias);
    });

    it('should throw error on failed DELETE request', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      const project = 'test-project';
      const topicId = 'test-topic';
      const alias = 'test-alias';

      await expect(kodexApi.removeAlias(project, topicId, alias)).rejects.toThrow(
        'Failed to remove alias'
      );
    });

    it('should handle network errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const project = 'test-project';
      const topicId = 'test-topic';
      const alias = 'test-alias';

      await expect(kodexApi.removeAlias(project, topicId, alias)).rejects.toThrow(
        'Network error'
      );
    });
  });
});
