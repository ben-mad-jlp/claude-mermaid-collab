import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchProjectNicknames, useProjectNicknames } from './nicknames';

global.fetch = vi.fn();

describe('fetchProjectNicknames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetchProjectNicknames returns the nicknames map on a 200 response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ project: '/repo', nicknames: { abc12345: 'happy-otter' } }),
    });

    const result = await fetchProjectNicknames('/repo');

    expect(global.fetch).toHaveBeenCalledWith('/api/supervisor/nicknames?project=%2Frepo');
    expect(result).toEqual({ abc12345: 'happy-otter' });
  });

  it('fetchProjectNicknames returns {} on a non-ok response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const result = await fetchProjectNicknames('/repo');

    expect(result).toEqual({});
  });
});

describe('useProjectNicknames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts at {} and updates to the fetched map', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ nicknames: { abc12345: 'happy-otter' } }),
    });

    const { result } = renderHook(() => useProjectNicknames('/repo'));

    expect(result.current).toEqual({});

    await waitFor(() => {
      expect(result.current).toEqual({ abc12345: 'happy-otter' });
    });
  });

  it('re-fetches when project changes', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ nicknames: { a: 'one' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ nicknames: { b: 'two' } }),
      });

    const { result, rerender } = renderHook(({ project }) => useProjectNicknames(project), {
      initialProps: { project: '/repo-a' },
    });

    await waitFor(() => {
      expect(result.current).toEqual({ a: 'one' });
    });

    rerender({ project: '/repo-b' });

    await waitFor(() => {
      expect(result.current).toEqual({ b: 'two' });
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
