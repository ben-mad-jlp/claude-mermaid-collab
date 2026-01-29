/**
 * Kodex API Tests
 *
 * Tests verify:
 * - addAlias successfully sends POST request
 * - removeAlias successfully sends DELETE request
 * - Error handling for failed requests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { kodexApi } from '../kodex-api';

// Mock fetch globally
global.fetch = vi.fn();

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
