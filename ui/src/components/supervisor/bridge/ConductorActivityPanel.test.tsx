/**
 * ConductorActivityPanel tests — mocks fetch + the websocket client, capturing the
 * registered handler so tests can fire synthetic `conductor_pass` events.
 * Covers: WS-prepend without refetch, mission filter narrowing, chip click callbacks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConductorActivityPanel, CONDUCTOR_RAW_MODE_KEY } from './ConductorActivityPanel';

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
  window.localStorage.clear();
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

    fireEvent.click(screen.getByTestId('entity-chip-epic-epic-aaa11111'));
    expect(onOpenEntity).toHaveBeenCalledWith('epic', 'epic-aaa11111');

    fireEvent.click(screen.getByTestId('entity-chip-leaf-leaf-bbb22222'));
    expect(onOpenEntity).toHaveBeenCalledWith('leaf', 'leaf-bbb22222');
  });

  describe('grouped rendering', () => {
    function mkGroupRow(overrides: Partial<typeof ROW_A> & { id: string; startedAt: number }) {
      return {
        project: 'proj1',
        missionId: 'mission-group',
        endedAt: 2000,
        arm: 'node',
        criteriaActed: [],
        filed: [],
        declined: [],
        outcome: 'ok',
        ran: true,
        ...overrides,
      };
    }

    it('collapses 27 identical rows into one entry with ×27 repeat annotation and first/last times', async () => {
      const fixture = Array.from({ length: 27 }, (_, i) => mkGroupRow({ id: `p${i}`, startedAt: 1000 + i * 10 }));
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rows: fixture }),
        }),
      ) as any;

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(1);
      });

      const repeat = screen.getByTestId('conductor-pass-repeat');
      expect(repeat.textContent).toContain('×27');
      const firstHM = new Date(fixture[0].startedAt).toTimeString().slice(0, 5);
      const lastHM = new Date(fixture[26].startedAt).toTimeString().slice(0, 5);
      expect(repeat.textContent).toContain(firstHM);
      expect(repeat.textContent).toContain(lastHM);
    });

    it('splits the mid-sequence differing-outcome fixture into exactly three entries', async () => {
      const fixture = Array.from({ length: 27 }, (_, i) => mkGroupRow({ id: `p${i}`, startedAt: 1000 + i * 10 }));
      const outlier = mkGroupRow({ id: 'p-outlier', startedAt: 1135, outcome: 'different-outcome' });
      fixture.splice(13, 0, outlier);

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rows: fixture }),
        }),
      ) as any;

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(3);
      });
    });

    it('renders a live in-flight entry showing arm, outcome and humanized nickname when rawMode is off', async () => {
      const liveRow = mkGroupRow({
        id: 'p-live',
        startedAt: 5000,
        endedAt: null,
        arm: 'serve',
        outcome: 'in-flight',
        criteriaActed: [{ criterionId: 'crit-1', action: 'serve', servedEpicId: 'epic-live1111' }],
      });

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [liveRow],
              nicknames: { 'epic-live1111': 'brave-fox' },
            }),
        }),
      ) as any;

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      const entry = await screen.findByTestId('conductor-pass-entry');
      expect(screen.getByTestId('conductor-pass-live')).toBeTruthy();
      expect(entry.textContent).toContain('serve');
      expect(entry.textContent).toContain('in-flight');
      expect(entry.textContent).toContain('brave-fox');
      expect(entry.textContent).not.toContain('epic-live1111');
    });
  });

  describe('with nicknames', () => {
    const FULL_UUID = '12345678-90ab-cdef-1234-567890abcdef';
    const ROW_UUID = {
      id: 'pass-uuid1',
      project: 'proj1',
      missionId: 'mission-aaa',
      startedAt: 1500,
      endedAt: 2500,
      arm: 'serve',
      criteriaActed: [{ criterionId: 'crit-1', action: 'serve', servedEpicId: FULL_UUID }],
      filed: [],
      declined: [],
      outcome: 'ok',
      ran: true,
    };

    beforeEach(() => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [ROW_UUID],
              nicknames: { [FULL_UUID]: 'happy-otter' },
            }),
        }),
      ) as any;
    });

    it('chip shows the fixture nickname while carrying the full raw id, and calls onOpenEntity with that id', async () => {
      const onOpenEntity = vi.fn();
      render(<ConductorActivityPanel project="proj1" onOpenEntity={onOpenEntity} />);

      const chip = await screen.findByTestId(`entity-chip-epic-${FULL_UUID}`);
      expect(chip.textContent).toBe('happy-otter');
      expect(chip.getAttribute('title')).toBe(FULL_UUID);
      expect(chip.getAttribute('data-entity-id')).toBe(FULL_UUID);

      fireEvent.click(chip);
      expect(onOpenEntity).toHaveBeenCalledWith('epic', FULL_UUID);
    });

    it('no full UUID is rendered in default mode', async () => {
      const { container } = render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId(`entity-chip-epic-${FULL_UUID}`);
      const uuidRe = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
      expect(container.textContent).not.toMatch(uuidRe);
    });

    it('clicking the raw toggle reveals the full UUID', async () => {
      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId(`entity-chip-epic-${FULL_UUID}`);
      fireEvent.click(screen.getByTestId('conductor-raw-toggle'));

      await waitFor(() => {
        expect(screen.getByTestId(`entity-chip-epic-${FULL_UUID}`).textContent).toBe(FULL_UUID);
      });
    });

    it('raw mode is still selected after unmount and remount', async () => {
      const { unmount } = render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId(`entity-chip-epic-${FULL_UUID}`);
      fireEvent.click(screen.getByTestId('conductor-raw-toggle'));
      await waitFor(() => {
        expect(window.localStorage.getItem(CONDUCTOR_RAW_MODE_KEY)).toBe('1');
      });
      unmount();

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);
      await waitFor(() => {
        expect(screen.getByTestId(`entity-chip-epic-${FULL_UUID}`).textContent).toBe(FULL_UUID);
      });
    });
  });
});
