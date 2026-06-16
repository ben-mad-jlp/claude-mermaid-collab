import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { StreamedViewport } from './StreamedViewport.js';

// Mock getFrameClient so we control the WS client in tests
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockOnMessage = vi.fn();
const mockConnect = vi.fn().mockResolvedValue(undefined);
let messageHandler: ((msg: unknown) => void) | null = null;

const mockClient = {
  connect: mockConnect,
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  onMessage: vi.fn((handler: (msg: unknown) => void) => {
    messageHandler = handler;
    return { unsubscribe: mockOnMessage };
  }),
};

vi.mock('@/lib/serverFrameWs', () => ({
  getFrameClient: vi.fn(() => mockClient),
}));

beforeEach(() => {
  vi.clearAllMocks();
  messageHandler = null;
  mockClient.onMessage.mockImplementation((handler: (msg: unknown) => void) => {
    messageHandler = handler;
    return { unsubscribe: mockOnMessage };
  });
  mockConnect.mockResolvedValue(undefined);
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
});
