import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePolledResource } from '../usePolledResource';

describe('usePolledResource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the first resolved data rendered while a second fetch is pending', async () => {
    const deferreds: Array<{
      resolve: (v: string) => void;
      reject: (e?: unknown) => void;
    }> = [];
    const fetcher = vi.fn(
      (_p: string) =>
        new Promise<string>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );

    const { result, unmount } = renderHook(() =>
      usePolledResource('k1', 'proj', fetcher),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferreds[0].resolve('A');
    });

    expect(result.current.data).toBe('A');
    expect(result.current.isRefreshing).toBe(false);

    act(() => {
      result.current.refreshNow();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('A');
    expect(result.current.isRefreshing).toBe(true);

    unmount();
  });

  it('keeps the prior data rendered when a refetch rejects', async () => {
    const deferreds: Array<{
      resolve: (v: string) => void;
      reject: (e?: unknown) => void;
    }> = [];
    const fetcher = vi.fn(
      (_p: string) =>
        new Promise<string>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );

    const { result, unmount } = renderHook(() =>
      usePolledResource('k2', 'proj', fetcher),
    );

    await act(async () => {
      deferreds[0].resolve('A');
    });

    expect(result.current.data).toBe('A');

    act(() => {
      result.current.refreshNow();
    });

    await act(async () => {
      const err = new Error('boom');
      // Attach a rejection handler so jsdom does not log an unhandled rejection.
      const p = Promise.reject(err);
      p.catch(() => {});
      deferreds[1].reject(err);
    });

    expect(result.current.data).toBe('A');
    expect(result.current.error).toBeTruthy();

    unmount();
  });

  it('refreshNow starts an immediate fetch ahead of the interval', async () => {
    const deferreds: Array<{
      resolve: (v: string) => void;
      reject: (e?: unknown) => void;
    }> = [];
    const fetcher = vi.fn(
      (_p: string) =>
        new Promise<string>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );

    const { result, unmount } = renderHook(() =>
      usePolledResource('k3', 'proj', fetcher),
    );

    expect(fetcher.mock.calls.length).toBe(1);

    await act(async () => {
      deferreds[0].resolve('A');
    });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fetcher.mock.calls.length).toBe(1);

    act(() => {
      result.current.refreshNow();
    });

    expect(fetcher.mock.calls.length).toBe(2);

    unmount();
  });

  it('changing the project prop starts an immediate fetch for the new project', () => {
    const deferreds: Array<{
      resolve: (v: string) => void;
      reject: (e?: unknown) => void;
    }> = [];
    const fetcher = vi.fn(
      (_p: string) =>
        new Promise<string>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );

    const { rerender, unmount } = renderHook(
      ({ project }: { project: string }) =>
        usePolledResource('k4', project, fetcher),
      { initialProps: { project: 'alpha' } },
    );

    expect(fetcher.mock.calls[0][0]).toBe('alpha');

    rerender({ project: 'beta' });

    expect(fetcher.mock.calls[fetcher.mock.calls.length - 1][0]).toBe('beta');

    unmount();
  });
});
