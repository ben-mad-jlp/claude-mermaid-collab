import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TranscriptPicker } from '../TranscriptPicker';

const sampleSessions = [
  {
    sessionId: 'abcdef1234567890deadbeef',
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    firstUserMessage: 'Refactor the auth module to use the new session store',
    turnCount: 12,
    model: 'claude-opus-4-7',
    lastModifiedAt: Date.now() - 1000,
  },
  {
    sessionId: 'fedcba0987654321cafebabe',
    startedAt: new Date(Date.now() - 7200_000).toISOString(),
    firstUserMessage:
      'A very long first message that should be truncated at eighty characters because it exceeds the truncation limit somewhere in here',
    turnCount: 3,
    model: 'claude-sonnet-4-5',
    lastModifiedAt: Date.now() - 2000,
  },
];

describe('TranscriptPicker', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(data: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    }) as unknown as typeof globalThis.fetch;
  }

  it('fetches sessions on mount and renders rows', async () => {
    mockFetch(sampleSessions);
    render(
      <TranscriptPicker
        project="/some/project"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/abcdef12/)).toBeTruthy();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent/sessions?project='),
    );
    expect(screen.getByText(/fedcba09/)).toBeTruthy();
    expect(screen.getByText(/12 turns/)).toBeTruthy();
    expect(screen.getByText(/claude-opus-4-7/)).toBeTruthy();
    expect(
      screen.getByText(/Refactor the auth module to use the new session store/),
    ).toBeTruthy();

    // Truncation: the long message should include an ellipsis
    const long = screen.getByText(/A very long first message/);
    expect(long.textContent?.length).toBeLessThanOrEqual(80);
    expect(long.textContent).toContain('…');
  });

  it('click on a row calls onSelect with sessionId', async () => {
    mockFetch(sampleSessions);
    const onSelect = vi.fn();
    render(
      <TranscriptPicker
        project="/some/project"
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/abcdef12/)).toBeTruthy();
    });

    const row = screen.getByText(/abcdef12/).closest('button');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('abcdef1234567890deadbeef');
  });

  it('Escape key calls onDismiss', async () => {
    mockFetch(sampleSessions);
    const onDismiss = vi.fn();
    render(
      <TranscriptPicker
        project="/some/project"
        onSelect={() => {}}
        onDismiss={onDismiss}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/abcdef12/)).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no sessions', async () => {
    mockFetch([]);
    render(
      <TranscriptPicker
        project="/some/project"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No prior sessions/)).toBeTruthy();
    });
  });
});
