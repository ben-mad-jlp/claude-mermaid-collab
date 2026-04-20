import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScrollAnchor } from '../useScrollAnchor';

function createMockElement(init: { scrollTop?: number; scrollHeight?: number; clientHeight?: number } = {}) {
  const listeners = new Map<string, Set<(e: any) => void>>();
  const el: any = {
    scrollTop: init.scrollTop ?? 0,
    scrollHeight: init.scrollHeight ?? 500,
    clientHeight: init.clientHeight ?? 500,
    firstElementChild: null,
    addEventListener: vi.fn((type: string, cb: any) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: any) => {
      listeners.get(type)?.delete(cb);
    }),
    scrollTo: vi.fn((opts: any) => {
      if (typeof opts === 'object' && opts !== null && 'top' in opts) {
        el.scrollTop = opts.top;
      } else if (typeof opts === 'number') {
        el.scrollTop = opts;
      }
    }),
    _fire: (type: string) => {
      listeners.get(type)?.forEach((cb) => cb({}));
    },
  };
  return el;
}

let observeCallbacks: Array<(entries?: any) => void> = [];
let observeCount = 0;
let disconnectCount = 0;

beforeEach(() => {
  observeCallbacks = [];
  observeCount = 0;
  disconnectCount = 0;
  (global as any).ResizeObserver = class {
    private cb: (entries?: any) => void;
    constructor(cb: (entries?: any) => void) {
      this.cb = cb;
      observeCallbacks.push(cb);
    }
    observe() {
      observeCount++;
    }
    unobserve() {}
    disconnect() {
      disconnectCount++;
    }
  };
});

afterEach(() => {
  delete (global as any).ResizeObserver;
  vi.restoreAllMocks();
});

describe('useScrollAnchor', () => {
  it('initial isNearBottom=true when container not yet attached', () => {
    const { result } = renderHook(() => useScrollAnchor());
    expect(result.current.isNearBottom).toBe(true);
  });

  it('near bottom when scrollTop=0, scrollHeight=clientHeight=500', () => {
    const el = createMockElement({ scrollTop: 0, scrollHeight: 500, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor());
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      el._fire('scroll');
    });
    expect(result.current.isNearBottom).toBe(true);
  });

  it('not near bottom when scrolled up beyond threshold (distance=1500)', () => {
    const el = createMockElement({ scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor({ threshold: 80 }));
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      el._fire('scroll');
    });
    expect(result.current.isNearBottom).toBe(false);
  });

  it('near bottom when within threshold (distance=50)', () => {
    const el = createMockElement({ scrollTop: 1450, scrollHeight: 2000, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor({ threshold: 80 }));
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      el._fire('scroll');
    });
    expect(result.current.isNearBottom).toBe(true);
  });

  it('ResizeObserver callback with increased scrollHeight + near bottom → scrollTo called', () => {
    const el = createMockElement({ scrollTop: 500, scrollHeight: 1000, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor());
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      el._fire('scroll');
    });
    el.scrollTo.mockClear();
    act(() => {
      el.scrollHeight = 1500;
      observeCallbacks.forEach((cb) => cb([]));
    });
    expect(el.scrollTo).toHaveBeenCalled();
  });

  it('ResizeObserver callback with near-bottom=false → scrollTo NOT called', () => {
    const el = createMockElement({ scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor({ threshold: 80 }));
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      el._fire('scroll');
    });
    el.scrollTo.mockClear();
    act(() => {
      el.scrollHeight = 3000;
      observeCallbacks.forEach((cb) => cb([]));
    });
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('scrollToBottom sets scrollTop to scrollHeight and marks near bottom true', () => {
    const el = createMockElement({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor());
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      result.current.scrollToBottom();
    });
    expect(el.scrollTop).toBe(1000);
    expect(result.current.isNearBottom).toBe(true);
  });

  it('custom threshold option respected', () => {
    const el = createMockElement({ scrollTop: 0, scrollHeight: 600, clientHeight: 500 });
    const { result, rerender } = renderHook(() => useScrollAnchor({ threshold: 50 }));
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    act(() => {
      el._fire('scroll');
    });
    expect(result.current.isNearBottom).toBe(false);
  });

  it('unmount disconnects observer and removes scroll listener', () => {
    const el = createMockElement();
    const { result, rerender, unmount } = renderHook(() => useScrollAnchor());
    act(() => {
      (result.current.containerRef as any).current = el;
    });
    rerender();
    unmount();
    expect(disconnectCount).toBeGreaterThan(0);
    expect(el.removeEventListener).toHaveBeenCalled();
  });
});
