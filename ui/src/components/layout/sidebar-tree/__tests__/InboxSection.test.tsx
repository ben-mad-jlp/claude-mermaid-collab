import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import { InboxSection } from '../sections/InboxSection';
import type { InboxEnvelope } from '../artifactInbox';

// Mock websocket
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(),
}));

import { getWebSocketClient } from '@/lib/websocket';

const mockGetWebSocketClient = getWebSocketClient as any;

describe('InboxSection', () => {
  let fetchSpy: any;
  let messageHandler: any;

  beforeEach(() => {
    fetchSpy = vi.fn();
    messageHandler = null;

    const mockOnMessage = vi.fn((handler: any) => {
      messageHandler = handler;
      return { unsubscribe: vi.fn() };
    });

    mockGetWebSocketClient.mockReturnValue({
      onMessage: mockOnMessage,
    });

    (global as any).fetch = fetchSpy;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the count badge for three pending envelopes', async () => {
    const mockEnvelopes: InboxEnvelope[] = [
      {
        schemaVersion: 1,
        envelopeId: 'env-1',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'alice@example.com' },
        artifact: { type: 'document', name: 'Doc 1', content: '' },
        state: 'pending',
      },
      {
        schemaVersion: 1,
        envelopeId: 'env-2',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { baseUrl: 'https://example.com' },
        artifact: { type: 'diagram', name: 'Diagram 1', content: '' },
        state: 'pending',
      },
      {
        schemaVersion: 1,
        envelopeId: 'env-3',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'bob@example.com' },
        artifact: { type: 'image', name: 'Image 1', content: '' },
        state: 'pending',
      },
    ];

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopes: mockEnvelopes }),
    });

    render(
      <InboxSection
        collapsed={false}
        forceExpanded={false}
        onToggle={vi.fn()}
      />
    );

    await waitFor(() => {
      const section = screen.getByTestId('sidebar-section-inbox');
      expect(within(section).getByText('(3)')).toBeDefined();
    });
  });

  it('each envelope row shows name, sender and received time', async () => {
    const mockEnvelopes: InboxEnvelope[] = [
      {
        schemaVersion: 1,
        envelopeId: 'env-1',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'alice@example.com' },
        artifact: { type: 'document', name: 'Important Doc', content: '' },
        state: 'pending',
      },
      {
        schemaVersion: 1,
        envelopeId: 'env-2',
        receivedAt: '2026-08-12T11:00:00Z',
        from: { baseUrl: 'https://server.example.com' },
        artifact: { type: 'diagram', name: 'System Diagram', content: '' },
        state: 'pending',
      },
    ];

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopes: mockEnvelopes }),
    });

    render(
      <InboxSection
        collapsed={false}
        forceExpanded={false}
        onToggle={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('inbox-row-env-1')).toBeDefined();
    });

    const row1 = screen.getByTestId('inbox-row-env-1');
    expect(row1.textContent).toContain('Important Doc');
    expect(row1.textContent).toContain('alice@example.com');
    // Check for time string (just verify it's not empty)
    expect(row1.textContent).toMatch(/ago|now/);

    const row2 = screen.getByTestId('inbox-row-env-2');
    expect(row2.textContent).toContain('System Diagram');
    expect(row2.textContent).toContain('server.example.com');
  });

  it('renders the Inbox row without a badge when the inbox is empty', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopes: [] }),
    });

    render(
      <InboxSection
        collapsed={false}
        forceExpanded={false}
        onToggle={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-section-inbox')).toBeDefined();
    });

    const section = screen.getByTestId('sidebar-section-inbox');
    expect(within(section).queryByText('(0)')).toBeNull();
  });

  it('an artifact_inbox_updated message refetches and updates the badge to (4)', async () => {
    const firstEnvelopes: InboxEnvelope[] = [
      {
        schemaVersion: 1,
        envelopeId: 'env-1',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'alice@example.com' },
        artifact: { type: 'document', name: 'Doc', content: '' },
        state: 'pending',
      },
      {
        schemaVersion: 1,
        envelopeId: 'env-2',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'bob@example.com' },
        artifact: { type: 'diagram', name: 'Diagram', content: '' },
        state: 'pending',
      },
      {
        schemaVersion: 1,
        envelopeId: 'env-3',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'charlie@example.com' },
        artifact: { type: 'image', name: 'Image', content: '' },
        state: 'pending',
      },
    ];

    const secondEnvelopes: InboxEnvelope[] = [
      ...firstEnvelopes,
      {
        schemaVersion: 1,
        envelopeId: 'env-4',
        receivedAt: '2026-08-12T12:00:00Z',
        from: { serverOwner: 'diana@example.com' },
        artifact: { type: 'document', name: 'New Doc', content: '' },
        state: 'pending',
      },
    ];

    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ envelopes: firstEnvelopes }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ envelopes: secondEnvelopes }),
      });

    render(
      <InboxSection
        collapsed={false}
        forceExpanded={false}
        onToggle={vi.fn()}
      />
    );

    await waitFor(() => {
      const section = screen.getByTestId('sidebar-section-inbox');
      expect(within(section).getByText('(3)')).toBeDefined();
    });

    // Trigger the WS message
    act(() => {
      messageHandler({ type: 'artifact_inbox_updated' });
    });

    await waitFor(() => {
      const section = screen.getByTestId('sidebar-section-inbox');
      expect(within(section).getByText('(4)')).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
