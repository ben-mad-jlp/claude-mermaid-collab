import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchCodeFile,
  peekPseudoFile,
  prefetchPseudoFile,
  invalidatePseudoFileCache,
  CodeFileNotFoundError,
  CodeFilePathError,
} from '../pseudo-api';

const origFetch = global.fetch;

function mockFetchOnce(response: Partial<Response> & { jsonData?: any }) {
  const impl = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    json: async () => response.jsonData,
  });
  global.fetch = impl as any;
  return impl;
}

describe('pseudo-api', () => {
  beforeEach(() => {
    invalidatePseudoFileCache();
  });
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  describe('fetchCodeFile', () => {
    it('returns a valid text response on happy path', async () => {
      mockFetchOnce({
        ok: true,
        jsonData: {
          kind: 'text',
          content: 'hello',
          language: 'ts',
          sizeBytes: 5,
          truncated: false,
          mtimeMs: 1000,
        },
      });

      const result = await fetchCodeFile('/p', '/abs/foo.ts');
      expect(result.kind).toBe('text');
      if (result.kind === 'text') {
        expect(result.content).toBe('hello');
      }
    });

    it('throws CodeFileNotFoundError on 404', async () => {
      mockFetchOnce({ ok: false, status: 404, statusText: 'Not Found' });
      await expect(fetchCodeFile('/p', '/abs/missing.ts')).rejects.toBeInstanceOf(
        CodeFileNotFoundError
      );
    });

    it('throws CodeFilePathError on 400', async () => {
      mockFetchOnce({ ok: false, status: 400, statusText: 'Bad Request' });
      await expect(fetchCodeFile('/p', 'bad')).rejects.toBeInstanceOf(CodeFilePathError);
    });

    it('appends allowLarge=1 to URL when opts.allowLarge is true', async () => {
      const impl = mockFetchOnce({
        ok: true,
        jsonData: {
          kind: 'text',
          content: '',
          language: null,
          sizeBytes: 0,
          truncated: false,
          mtimeMs: 0,
        },
      });

      await fetchCodeFile('/p', '/abs/foo.ts', { allowLarge: true });
      const calledUrl = impl.mock.calls[0][0] as string;
      expect(calledUrl).toContain('allowLarge=1');
    });

    it('does not append allowLarge when opts.allowLarge is not set', async () => {
      const impl = mockFetchOnce({
        ok: true,
        jsonData: {
          kind: 'text',
          content: '',
          language: null,
          sizeBytes: 0,
          truncated: false,
          mtimeMs: 0,
        },
      });
      await fetchCodeFile('/p', '/abs/foo.ts');
      const calledUrl = impl.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('allowLarge');
    });
  });

  describe('peekPseudoFile', () => {
    it('returns null when not cached', () => {
      expect(peekPseudoFile('/p', '/abs/nope.ts')).toBeNull();
    });
  });

  describe('prefetchPseudoFile', () => {
    it('no-ops (does not call fetch) when already cached', async () => {
      // Warm the cache via a real-ish fetch call
      mockFetchOnce({
        ok: true,
        jsonData: {
          filePath: '/abs/foo.ts',
          title: 't',
          purpose: '',
          moduleContext: '',
          syncedAt: null,
          methods: [],
        },
      });
      const mod = await import('../pseudo-api');
      await mod.fetchPseudoFile('/p', '/abs/foo.ts');

      // Now prefetch should skip
      const impl = vi.fn();
      global.fetch = impl as any;
      prefetchPseudoFile('/p', '/abs/foo.ts');
      // microtask flush
      await Promise.resolve();
      expect(impl).not.toHaveBeenCalled();
    });

    it('is fire-and-forget: swallows errors without throwing', async () => {
      const impl = vi.fn().mockRejectedValue(new Error('network'));
      global.fetch = impl as any;
      // Should not throw synchronously
      expect(() => prefetchPseudoFile('/p', '/abs/never-cached.ts')).not.toThrow();
      // Give the microtask queue a chance to settle
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
