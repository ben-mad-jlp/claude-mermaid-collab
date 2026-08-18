import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ArtifactTree } from '../ArtifactTree';
import { useSessionStore } from '../../../../stores/sessionStore';
import { useSidebarTreeStore } from '../../../../stores/sidebarTreeStore';

// Mock websocket — useArtifactInbox subscribes to it unconditionally.
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(() => ({ onMessage: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
}));

/**
 * Test suite for InboxSection visibility when no session is selected.
 * The Inbox section is a global, cross-project surface that should render
 * even when no session is selected.
 */
describe('InboxSection visibility without a selected session', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      currentSession: null,
      isLoading: false,
      error: null,
      diagrams: [],
      selectedDiagramId: null,
      documents: [],
      selectedDocumentId: null,
      designs: [],
      selectedDesignId: null,
      spreadsheets: [],
      selectedSpreadsheetId: null,
      snippets: [],
      selectedSnippetId: null,
      embeds: [],
      images: [],
      sessionTodos: [],
      sessionTodosShowCompleted: false,
      sessionTodosFetchSeq: 0,
      collabState: null,
      pendingDiff: null,
    } as any);
    useSidebarTreeStore.setState({
      collapsedSections: new Set<string>(),
      showDeprecated: false,
      searchQuery: '',
      forceExpandedSections: new Set<string>(),
    });

    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        envelopes: [
          {
            schemaVersion: 1,
            envelopeId: 'f2826d30-910b-4826-a661-79c62e3df88a',
            receivedAt: '2026-08-13T03:25:26.277Z',
            from: { serverOwner: 'watcher-demo', baseUrl: 'http://localhost:9002' },
            artifact: { type: 'document', name: 'Hello from the artifact inbox', content: 'It works' },
            state: 'pending',
          },
        ],
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('the inbox section renders with a pending envelope and no session selected', async () => {
    render(<ArtifactTree />);

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-section-inbox')).toBeInTheDocument();
    });

    // Assert the badge text matches the pending envelope count
    const inboxSection = screen.getByTestId('sidebar-section-inbox');
    expect(within(inboxSection).getByText('(1)')).toBeInTheDocument();
  });

  it('the session placeholder still renders for the rest of the tree', async () => {
    render(<ArtifactTree />);

    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-empty')).toHaveTextContent('Select a session');
  });
});
