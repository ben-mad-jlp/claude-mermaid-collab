import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxSection } from '../sections/InboxSection';
import type { InboxEnvelope } from '../artifactInbox';

// Mock websocket
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(),
}));

import { getWebSocketClient } from '@/lib/websocket';

const mockGetWebSocketClient = getWebSocketClient as any;

describe('InboxAdopt', () => {
  let fetchSpy: any;
  let messageHandler: any;
  let projectsResponse: any;
  let sessionsResponse: any;
  let inboxResponse: any;

  beforeEach(() => {
    fetchSpy = vi.fn();
    messageHandler = null;
    let inboxFetchCount = 0;

    const mockOnMessage = vi.fn((handler: any) => {
      messageHandler = handler;
      return { unsubscribe: vi.fn() };
    });

    mockGetWebSocketClient.mockReturnValue({
      onMessage: mockOnMessage,
    });

    projectsResponse = {
      projects: [
        { path: '/project/a', name: 'Project A', lastAccess: '2026-08-12T12:00:00Z' },
        { path: '/project/b', name: 'Project B', lastAccess: '2026-08-12T11:00:00Z' },
      ],
    };

    sessionsResponse = {
      sessions: [
        { project: '/project/a', session: 'session-1', lastAccess: '2026-08-12T12:00:00Z' },
        { project: '/project/a', session: 'session-2', lastAccess: '2026-08-12T11:00:00Z' },
      ],
    };

    inboxResponse = {
      envelopes: [
        {
          schemaVersion: 1,
          envelopeId: 'env-1',
          receivedAt: '2026-08-12T12:00:00Z',
          from: { serverOwner: 'alice@example.com' },
          artifact: { type: 'document', name: 'Doc 1', content: '' },
          state: 'pending',
        },
      ],
    };

    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url.startsWith('/api/projects')) {
        return Promise.resolve({
          ok: true,
          json: async () => projectsResponse,
        });
      } else if (url.startsWith('/api/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => sessionsResponse,
        });
      } else if (url.startsWith('/api/artifact-inbox/env-1/adopt')) {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({}),
          });
        }
      } else if (url === '/api/artifact-inbox') {
        // Track calls to distinguish initial fetch from refetch
        inboxFetchCount++;
        // Return a copy of the envelope array to allow mutations
        const response = inboxFetchCount === 1
          ? { envelopes: [...inboxResponse.envelopes] }
          : { envelopes: [] };
        return Promise.resolve({
          ok: true,
          json: async () => response,
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
    });

    (global as any).fetch = fetchSpy;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('adopt flow: picker lists only registered projects and sessions, posts once, and clears the row', async () => {
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

    // Click adopt button to open picker
    const adoptButton = screen.getByTestId('inbox-adopt-env-1');
    await userEvent.click(adoptButton);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-adopt-picker')).toBeDefined();
    });

    const projectSelect = screen.getByTestId('inbox-adopt-project') as HTMLSelectElement;
    const sessionSelect = screen.getByTestId('inbox-adopt-session') as HTMLSelectElement;

    // Verify project options match mocked projects
    const projectOptions = Array.from(projectSelect.options)
      .slice(1) // Skip placeholder
      .map((o) => o.value);
    expect(projectOptions).toEqual(['/project/a', '/project/b']);

    // Verify session select is disabled initially
    expect(sessionSelect.disabled).toBe(true);

    // Select a project
    await userEvent.selectOptions(projectSelect, '/project/a');

    await waitFor(() => {
      expect(sessionSelect.disabled).toBe(false);
    });

    // Verify session options
    const sessionOptions = Array.from(sessionSelect.options)
      .slice(1) // Skip placeholder
      .map((o) => o.value);
    expect(sessionOptions).toEqual(['session-1', 'session-2']);

    // Verify confirm button is disabled until both selects have values
    const confirmButton = screen.getByTestId('inbox-adopt-confirm') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    // Select a session
    await userEvent.selectOptions(sessionSelect, 'session-1');

    await waitFor(() => {
      expect(confirmButton.disabled).toBe(false);
    });

    // Click confirm
    await userEvent.click(confirmButton);

    // Verify the POST call was made
    await waitFor(() => {
      const adoptCalls = fetchSpy.mock.calls.filter((call: any[]) =>
        call[0].includes('/api/artifact-inbox/env-1/adopt')
      );
      expect(adoptCalls.length).toBeGreaterThan(0);
      const [, init] = adoptCalls[0];
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ project: '/project/a', session: 'session-1' });
    });

    // After refetch, the envelope should be cleared and row removed
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-row-env-1')).toBeNull();
    });

    // Verify count badge is gone (empty inbox)
    const section = screen.getByTestId('sidebar-section-inbox');
    expect(within(section).queryByText('(1)')).toBeNull();
  });

  it('adopt failure: a non-ok adopt response shows an inline error and keeps the row', async () => {
    let inboxFetchCount = 0;
    fetchSpy.mockImplementation((url: string, init?: any) => {
      if (url.startsWith('/api/projects')) {
        return Promise.resolve({
          ok: true,
          json: async () => projectsResponse,
        });
      } else if (url.startsWith('/api/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => sessionsResponse,
        });
      } else if (url.startsWith('/api/artifact-inbox/env-1/adopt')) {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({}),
          });
        }
      } else if (url === '/api/artifact-inbox') {
        inboxFetchCount++;
        return Promise.resolve({
          ok: true,
          json: async () => ({ envelopes: [...inboxResponse.envelopes] }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
    });

    (global as any).fetch = fetchSpy;

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

    // Click adopt button
    const adoptButton = screen.getByTestId('inbox-adopt-env-1');
    await userEvent.click(adoptButton);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-adopt-picker')).toBeDefined();
    });

    // Select project and session
    await userEvent.selectOptions(screen.getByTestId('inbox-adopt-project'), '/project/a');

    await waitFor(() => {
      expect((screen.getByTestId('inbox-adopt-session') as HTMLSelectElement).disabled).toBe(false);
    });

    await userEvent.selectOptions(screen.getByTestId('inbox-adopt-session'), 'session-1');

    // Click confirm
    const confirmButton = screen.getByTestId('inbox-adopt-confirm');
    await userEvent.click(confirmButton);

    // Verify error message is shown
    await waitFor(() => {
      expect(screen.getByTestId('inbox-adopt-error')).toBeDefined();
    });

    // Verify the row is still present
    expect(screen.getByTestId('inbox-row-env-1')).toBeDefined();
  });
});
