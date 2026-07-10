import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardOwner, KeyboardPriority, __resetKeyboardOwners } from '../useKeyboardOwner';

beforeEach(() => {
  __resetKeyboardOwners();
});

describe('useKeyboardOwner', () => {
  it('only the highest-priority owner receives keydown events', () => {
    const focalHandler = vi.fn();
    const signalsHandler = vi.fn();

    renderHook(() => useKeyboardOwner(KeyboardPriority.FOCAL, focalHandler));
    renderHook(() => useKeyboardOwner(KeyboardPriority.SIGNALS, signalsHandler));

    act(() => {
      const ev = new KeyboardEvent('keydown', { key: '1' });
      window.dispatchEvent(ev);
    });

    expect(focalHandler).toHaveBeenCalledTimes(1);
    expect(signalsHandler).not.toHaveBeenCalled();
  });

  it('unmounting high-priority owner makes lower-priority owner active', () => {
    const focalHandler = vi.fn();
    const signalsHandler = vi.fn();

    const { unmount: unmountFocal } = renderHook(() =>
      useKeyboardOwner(KeyboardPriority.FOCAL, focalHandler),
    );
    renderHook(() => useKeyboardOwner(KeyboardPriority.SIGNALS, signalsHandler));

    act(() => {
      unmountFocal();
    });

    act(() => {
      const ev = new KeyboardEvent('keydown', { key: '1' });
      window.dispatchEvent(ev);
    });

    expect(focalHandler).not.toHaveBeenCalled();
    expect(signalsHandler).toHaveBeenCalledTimes(1);
  });

  it('enabled:false owner neither fires nor suppresses lower-priority owner', () => {
    const highHandler = vi.fn();
    const lowHandler = vi.fn();

    renderHook(() => useKeyboardOwner(KeyboardPriority.FOCAL, highHandler, false));
    renderHook(() => useKeyboardOwner(KeyboardPriority.SIGNALS, lowHandler, true));

    act(() => {
      const ev = new KeyboardEvent('keydown', { key: '1' });
      window.dispatchEvent(ev);
    });

    expect(highHandler).not.toHaveBeenCalled();
    expect(lowHandler).toHaveBeenCalledTimes(1);
  });

  it('last unregister removes the window listener', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount: unmountFocal } = renderHook(() =>
      useKeyboardOwner(KeyboardPriority.FOCAL, vi.fn()),
    );
    const { unmount: unmountSignals } = renderHook(() =>
      useKeyboardOwner(KeyboardPriority.SIGNALS, vi.fn()),
    );

    act(() => {
      unmountFocal();
    });

    expect(removeEventListenerSpy).not.toHaveBeenCalled();

    act(() => {
      unmountSignals();
    });

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('enabled toggle registers/unregisters without unmounting', () => {
    const handler = vi.fn();

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useKeyboardOwner(KeyboardPriority.FOCAL, handler, enabled),
      { initialProps: { enabled: false } },
    );

    act(() => {
      const ev = new KeyboardEvent('keydown', { key: '1' });
      window.dispatchEvent(ev);
    });

    expect(handler).not.toHaveBeenCalled();

    act(() => {
      rerender({ enabled: true });
    });

    act(() => {
      const ev = new KeyboardEvent('keydown', { key: '1' });
      window.dispatchEvent(ev);
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ties resolve to the earliest registrant (stable)', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    renderHook(() => useKeyboardOwner(KeyboardPriority.FOCAL, handler1));
    renderHook(() => useKeyboardOwner(KeyboardPriority.FOCAL, handler2));

    act(() => {
      const ev = new KeyboardEvent('keydown', { key: '1' });
      window.dispatchEvent(ev);
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });
});
