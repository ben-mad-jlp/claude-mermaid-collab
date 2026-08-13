import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ArtifactTree } from '../../ArtifactTree';
import { useSessionStore } from '../../../../../stores/sessionStore';
import { useSidebarTreeStore } from '../../../../../stores/sidebarTreeStore';

// Mock websocket — useArtifactInbox subscribes to it unconditionally.
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(() => ({ onMessage: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
}));

/**
 * Repro for mission 12ae01d9 crit 6: the artifact-inbox sidebar section is a
 * global, cross-project surface (useArtifactInbox fetches GET /api/artifact-inbox
 * with no session/project argument), but ArtifactTree.tsx:1002 gates its ENTIRE
 * render — including InboxSection — behind `noSession = !currentSession`. With
 * a pending envelope present and no session selected in the sidebar (the
 * observed state of the live desktop app at http://localhost:9002), the Inbox
 * section never mounts and the pending envelope is invisible.
 */
describe('InboxSection visibility without a selected session (quarantine repro)', () => {
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

  it('FAILS today: sidebar-section-inbox never mounts when no session is selected, even though GET /api/artifact-inbox has a pending envelope', async () => {
    render(<ArtifactTree />);

    // The empty-session fallback is what actually renders instead.
    expect(screen.getByTestId('sidebar-empty')).toBeInTheDocument();

    // This is the bug: the Inbox section is a cross-project surface and should
    // still mount with a badge count, independent of session selection.
    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-section-inbox')).not.toBeNull();
    });
  });
});
