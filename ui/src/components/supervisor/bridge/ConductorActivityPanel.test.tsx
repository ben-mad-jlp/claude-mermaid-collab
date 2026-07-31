/**
 * ConductorActivityPanel tests — mocks fetch + the websocket client, capturing the
 * registered handler so tests can fire synthetic `conductor_pass` events.
 * Covers: WS-prepend without refetch, mission filter narrowing, chip click callbacks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConductorActivityPanel } from './ConductorActivityPanel';

let capturedHandler: ((msg: any) => void) | null = null;

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: (h: any) => {
      capturedHandler = h;
      return { unsubscribe: () => {} };
    },
  }),
}));

const ROW_A = {
  id: 'pass-a1',
  project: 'proj1',
  missionId: 'mission-aaa',
  startedAt: 1000,
  endedAt: 2000,
  arm: 'serve',
  criteriaActed: [{ criterionId: 'crit-1', action: 'serve', servedEpicId: 'epic-aaa11111' }],
  filed: [],
  declined: [],
  outcome: 'ok',
  ran: true,
};

const ROW_B = {
  id: 'pass-b1',
  project: 'proj1',
  missionId: 'mission-bbb',
  startedAt: 2000,
  endedAt: 3000,
  arm: 'file',
  criteriaActed: [],
  filed: [{ kind: 'leaf', id: 'leaf-bbb22222', title: 'Some leaf' }],
  declined: [],
  outcome: 'ok',
  ran: true,
};

const ROW_WS = {
  id: 'pass-ws1',
  project: 'proj1',
  missionId: 'mission-aaa',
  startedAt: 3000,
  endedAt: null,
  arm: 'serve',
  criteriaActed: [],
  filed: [],
  declined: [],
  outcome: null,
  ran: false,
};

beforeEach(() => {
  capturedHandler = null;
  global.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ rows: [ROW_B, ROW_A] }),
    }),
  ) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConductorActivityPanel', () => {
  it('prepends a new entry on conductor_pass WS event without refetching', async () => {
    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(2);
    });

    const beforeCount = (global.fetch as any).mock.calls.length;

    expect(capturedHandler).not.toBeNull();
    capturedHandler!({ type: 'conductor_pass', project: 'proj1', row: ROW_WS });

    await waitFor(() => {
      expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(3);
    });

    const entries = screen.getAllByTestId('conductor-pass-entry');
    expect(entries[0].getAttribute('data-pass-id')).toBe('pass-ws1');

    expect((global.fetch as any).mock.calls.length).toBe(beforeCount);
  });

  it('narrows rendered entries to the selected mission', async () => {
    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(2);
    });

    fireEvent.change(screen.getByTestId('conductor-mission-filter'), {
      target: { value: 'mission-aaa' },
    });

    await waitFor(() => {
      const entries = screen.getAllByTestId('conductor-pass-entry');
      expect(entries).toHaveLength(1);
      expect(entries[0].getAttribute('data-mission-id')).toBe('mission-aaa');
    });
  });

  it('calls onOpenEntity with the exact kind and id for epic and leaf chips', async () => {
    const onOpenEntity = vi.fn();
    render(<ConductorActivityPanel project="proj1" onOpenEntity={onOpenEntity} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(2);
    });

    fireEvent.click(screen.getByTestId('conductor-chip-epic-epic-aaa11111'));
    expect(onOpenEntity).toHaveBeenCalledWith('epic', 'epic-aaa11111');

    fireEvent.click(screen.getByTestId('conductor-chip-leaf-leaf-bbb22222'));
    expect(onOpenEntity).toHaveBeenCalledWith('leaf', 'leaf-bbb22222');
  });
});
