import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useArtifactInbox } from '../useArtifactInbox';
import { INBOX_LIST_PATH } from '../artifactInbox';
import { SECTION_DEFS, MULTISELECT_EXCLUDED_SECTIONS } from '../section-registry';

// Mock websocket
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(),
}));

import { getWebSocketClient } from '@/lib/websocket';

const mockGetWebSocketClient = getWebSocketClient as any;

describe('useArtifactInbox', () => {
  let fetchSpy: any;
  let mockOnMessage: any;

  beforeEach(() => {
    fetchSpy = vi.fn();
    mockOnMessage = vi.fn();

    // Setup default mock: return a client with onMessage
    mockGetWebSocketClient.mockReturnValue({
      onMessage: mockOnMessage.mockReturnValue({
        unsubscribe: vi.fn(),
      }),
    });

    (global as any).fetch = fetchSpy;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the inbox list once on mount and exposes pending envelopes', async () => {
    const mockData = {
      envelopes: [
        {
          envelopeId: '1',
          state: 'pending',
          receivedAt: '2026-08-12T00:00:00Z',
          from: { session: 'test' },
          artifact: { type: 'document', name: 'test', content: 'test' },
        },
        {
          envelopeId: '2',
          state: 'adopted',
          receivedAt: '2026-08-12T00:00:00Z',
          from: { session: 'test' },
          artifact: { type: 'document', name: 'test', content: 'test' },
        },
      ],
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useArtifactInbox());

    await waitFor(() => {
      expect(result.current.envelopes).toHaveLength(1);
    });

    expect(fetchSpy).toHaveBeenCalledWith(INBOX_LIST_PATH);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.envelopes[0].envelopeId).toBe('1');
  });

  it('refetches once when an artifact_inbox_updated ws message arrives', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ envelopes: [] }),
    });

    let messageHandler: any;
    mockOnMessage.mockImplementation((handler: any) => {
      messageHandler = handler;
      return { unsubscribe: vi.fn() };
    });

    renderHook(() => useArtifactInbox());

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Trigger the message handler
    messageHandler({ type: 'artifact_inbox_updated' });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('renders with a null websocket client and fetches once', async () => {
    mockGetWebSocketClient.mockReturnValue(null);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopes: [] }),
    });

    const { result } = renderHook(() => useArtifactInbox());

    await waitFor(() => {
      expect(result.current).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('registers inbox as the first sidebar section and excludes it from multiselect', () => {
    expect(SECTION_DEFS[0].id).toBe('inbox');
    expect(MULTISELECT_EXCLUDED_SECTIONS.has('inbox')).toBe(true);
  });
});
