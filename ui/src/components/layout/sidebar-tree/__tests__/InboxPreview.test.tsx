import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { InboxSection } from '../sections/InboxSection';
import type { InboxEnvelope } from '../artifactInbox';

// Mock websocket
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(),
}));

import { getWebSocketClient } from '@/lib/websocket';

const mockGetWebSocketClient = getWebSocketClient as any;

describe('InboxPreview', () => {
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

  it('clicking an envelope row opens the VIEWER without any import call', async () => {
    const mockEnvelope: InboxEnvelope = {
      schemaVersion: 1,
      envelopeId: 'env-1',
      receivedAt: '2026-08-12T12:00:00Z',
      from: {
        serverOwner: 'alice@example.com',
        note: 'for review',
      },
      artifact: {
        type: 'document',
        name: 'Test Doc',
        content: 'PREVIEW BODY TEXT',
      },
      historyNote: {
        versions: 3,
        firstAt: '2026-08-10T10:00:00Z',
        lastAt: '2026-08-12T12:00:00Z',
      },
      state: 'pending',
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopes: [mockEnvelope] }),
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

    // Clear the fetch spy record of the initial load
    fetchSpy.mockClear();

    // Click the row to preview
    fireEvent.click(screen.getByTestId('inbox-row-env-1'));

    // Assert preview is shown
    expect(screen.getByTestId('inbox-viewer')).toBeDefined();
    expect(screen.getByTestId('inbox-viewer-content')).toBeDefined();
    expect(screen.getByTestId('inbox-viewer-content').textContent).toContain('PREVIEW BODY TEXT');
    expect(screen.getByTestId('inbox-viewer').textContent).toContain('alice@example.com');

    // Assert history note is shown
    expect(screen.getByTestId('inbox-viewer-history-note')).toBeDefined();
    expect(screen.getByTestId('inbox-viewer-history-note').textContent).toContain('3 versions');

    // Assert no fetch calls were made
    expect(fetchSpy.mock.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Assert no URLs matching adopt/dismiss or artifact API endpoints were called
    const callUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(callUrls).not.toContain(expect.stringMatching(/\/adopt|\/dismiss/));
    expect(callUrls).not.toContain(expect.stringMatching(/\/api\/(documents|diagrams|designs|snippets|spreadsheets|images)/));
  });

  it('a second click on the same row closes the preview', async () => {
    const mockEnvelope: InboxEnvelope = {
      schemaVersion: 1,
      envelopeId: 'env-1',
      receivedAt: '2026-08-12T12:00:00Z',
      from: {
        serverOwner: 'alice@example.com',
      },
      artifact: {
        type: 'document',
        name: 'Test Doc',
        content: 'PREVIEW BODY TEXT',
      },
      state: 'pending',
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ envelopes: [mockEnvelope] }),
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

    // First click: open preview
    fireEvent.click(screen.getByTestId('inbox-row-env-1'));
    expect(screen.getByTestId('inbox-viewer')).toBeDefined();

    // Second click: close preview
    fireEvent.click(screen.getByTestId('inbox-row-env-1'));
    expect(screen.queryByTestId('inbox-viewer')).toBeNull();
  });
});
