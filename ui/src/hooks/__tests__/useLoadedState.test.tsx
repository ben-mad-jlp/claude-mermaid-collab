import { renderHook, act } from '@testing-library/react';
import { useLoadedState } from '../useLoadedState';
import { describe, it, expect } from 'vitest';

describe('useLoadedState', () => {
  it('settle transitions loading to loaded and sets hasLoadedOnce', () => {
    const { result } = renderHook(() => useLoadedState([1, 2, 3]));

    expect(result.current.status).toBe('loading');
    expect(result.current.hasLoadedOnce).toBe(false);
    expect(result.current.data).toEqual([1, 2, 3]);

    act(() => {
      result.current.settle([4, 5, 6]);
    });

    expect(result.current.status).toBe('loaded');
    expect(result.current.hasLoadedOnce).toBe(true);
    expect(result.current.data).toEqual([4, 5, 6]);
    expect(result.current.error).toBeNull();
  });

  it('fail transitions loading to error and sets hasLoadedOnce', () => {
    const { result } = renderHook(() => useLoadedState([1, 2, 3]));

    const testError = new Error('test failure');

    act(() => {
      result.current.fail(testError);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.hasLoadedOnce).toBe(true);
    expect(result.current.error).toBe(testError);
    expect(result.current.data).toEqual([1, 2, 3]);
  });

  it('reset clears hasLoadedOnce back to false', () => {
    const { result } = renderHook(() => useLoadedState([1, 2, 3]));

    act(() => {
      result.current.settle([4, 5, 6]);
    });

    expect(result.current.status).toBe('loaded');
    expect(result.current.hasLoadedOnce).toBe(true);
    expect(result.current.data).toEqual([4, 5, 6]);

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('loading');
    expect(result.current.hasLoadedOnce).toBe(false);
    expect(result.current.data).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
  });
});
