import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { StreamedViewport } from './StreamedViewport.js';
import { canvasPointToFrac, cdpModifiers } from './streamedInput.js';

// Mock getFrameClient so we control the WS client in tests
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockOnMessage = vi.fn();
const mockConnect = vi.fn().mockResolvedValue(undefined);
let messageHandler: ((msg: unknown) => void) | null = null;
let connectHandler: (() => void) | null = null;

const mockSend = vi.fn();

const mockClient = {
  connect: mockConnect,
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  send: mockSend,
  onMessage: vi.fn((handler: (msg: unknown) => void) => {
    messageHandler = handler;
    return { unsubscribe: mockOnMessage };
  }),
  onConnect: vi.fn((handler: () => void) => {
    connectHandler = handler;
    return { unsubscribe: vi.fn() };
  }),
};

vi.mock('@/lib/serverFrameWs', () => ({
  getFrameClient: vi.fn(() => mockClient),
}));

beforeEach(() => {
  vi.clearAllMocks();
  messageHandler = null;
  connectHandler = null;
  mockClient.onMessage.mockImplementation((handler: (msg: unknown) => void) => {
    messageHandler = handler;
    return { unsubscribe: mockOnMessage };
  });
  mockClient.onConnect.mockImplementation((handler: () => void) => {
    connectHandler = handler;
    return { unsubscribe: vi.fn() };
  });
  mockConnect.mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StreamedViewport', () => {
  it('subscribes to browser:<session> on mount and unsubscribes on unmount', async () => {
    const { unmount } = render(<StreamedViewport session="sess-abc" />);

    // Wait for connect().then() to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSubscribe).toHaveBeenCalledWith('browser:sess-abc');

    unmount();

    expect(mockOnMessage).toHaveBeenCalled(); // sub.unsubscribe() called
    expect(mockUnsubscribe).toHaveBeenCalledWith('browser:sess-abc');
  });

  it('paints frame and stores meta for matching session', async () => {
    const metaRef = { current: null as null | object };
    render(
      <StreamedViewport
        session="sess-abc"
        metaRef={metaRef as React.MutableRefObject<import('./StreamedViewport.js').FrameMeta | null>}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const meta = {
      offsetTop: 10,
      pageScaleFactor: 1,
      deviceWidth: 1280,
      deviceHeight: 800,
      timestamp: 1000,
    };

    act(() => {
      messageHandler?.({
        type: 'browser_frame',
        session: 'sess-abc',
        data: 'abc123base64',
        meta,
      });
    });

    expect(metaRef.current).toEqual(meta);
  });

  it('ignores browser_frame messages for a different session', async () => {
    const metaRef = { current: null as null | object };
    render(
      <StreamedViewport
        session="sess-abc"
        metaRef={metaRef as React.MutableRefObject<import('./StreamedViewport.js').FrameMeta | null>}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      messageHandler?.({
        type: 'browser_frame',
        session: 'DIFFERENT-SESSION',
        data: 'xyz',
        meta: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 800, deviceHeight: 600 },
      });
    });

    expect(metaRef.current).toBeNull();
  });

  it('ignores non-browser_frame message types', async () => {
    const metaRef = { current: null as null | object };
    render(
      <StreamedViewport
        session="sess-abc"
        metaRef={metaRef as React.MutableRefObject<import('./StreamedViewport.js').FrameMeta | null>}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      messageHandler?.({ type: 'heartbeat', session: 'sess-abc' });
    });

    expect(metaRef.current).toBeNull();
  });

  it('sends browser_resize on mount', async () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { container } = render(<StreamedViewport session="sess-resize" />);
    await act(async () => { await Promise.resolve(); });

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'clientWidth',  { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });

    act(() => { rafQueue.forEach(cb => cb(0)); });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'browser_resize', session: 'sess-resize', width: 800, height: 600 })
    );
  });

  it('re-subscribes on WS reconnect via onConnect handler', async () => {
    render(<StreamedViewport session="sess-reconn" />);
    await act(async () => { await Promise.resolve(); });

    expect(mockSubscribe).toHaveBeenCalledWith('browser:sess-reconn');
    const callsBefore = mockSubscribe.mock.calls.length;

    act(() => { connectHandler?.(); });

    expect(mockSubscribe.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(mockSubscribe).toHaveBeenLastCalledWith('browser:sess-reconn');
  });
});

describe('canvasPointToFrac', () => {
  function makeCanvas(width: number, height: number, rectOverride?: Partial<DOMRect>): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const defaultRect = { left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ ...defaultRect, ...rectOverride } as DOMRect);
    return canvas;
  }

  it('maps center of a square frame in a square element to {0.5, 0.5}', () => {
    // canvas 100x100 in a 400x400 element: scale=4, dispW=400, dispH=400, offX=0, offY=0
    const canvas = makeCanvas(100, 100, { left: 0, top: 0, width: 400, height: 400 });
    const { xFrac, yFrac } = canvasPointToFrac(canvas, 200, 200);
    expect(xFrac).toBeCloseTo(0.5);
    expect(yFrac).toBeCloseTo(0.5);
  });

  it('clamps out-of-image points to [0,1] with letterbox bands', () => {
    // canvas 200x200 in a 400x200 element (wide): scale=1, dispW=200, dispH=200, offX=100, offY=0
    const canvas = makeCanvas(200, 200, { left: 0, top: 0, width: 400, height: 200 });
    // click at x=0 (left letterbox band) → clamped to 0
    const left = canvasPointToFrac(canvas, 0, 100);
    expect(left.xFrac).toBe(0);
    // click at x=399 (right letterbox band) → clamped to 1
    const right = canvasPointToFrac(canvas, 399, 100);
    expect(right.xFrac).toBe(1);
  });

  it('returns {0,0} when canvas dims are zero', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    expect(canvasPointToFrac(canvas, 100, 100)).toEqual({ xFrac: 0, yFrac: 0 });
  });
});

describe('cdpModifiers', () => {
  it('packs Ctrl+Shift to 10', () => {
    expect(cdpModifiers({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true })).toBe(10);
  });

  it('packs Alt to 1', () => {
    expect(cdpModifiers({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(1);
  });

  it('packs no modifiers to 0', () => {
    expect(cdpModifiers({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(0);
  });
});

describe('StreamedViewport input forwarding', () => {
  it('sends browser_input mouse down on pointerdown', async () => {
    const { container } = render(<StreamedViewport session="sess-input" />);
    await act(async () => { await Promise.resolve(); });

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    // Give the canvas non-zero dims so fractions are non-degenerate
    Object.defineProperty(canvas, 'width', { value: 100, configurable: true });
    Object.defineProperty(canvas, 'height', { value: 100, configurable: true });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100,
      right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: 50, clientY: 50, button: 0,
      }));
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'browser_input', action: 'mouse', event: 'down' })
    );
  });
});
