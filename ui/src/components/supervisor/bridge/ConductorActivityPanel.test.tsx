/**
 * ConductorActivityPanel tests — mocks fetch + the websocket client, capturing the
 * registered handler so tests can fire synthetic `conductor_pass` events.
 * Covers: WS-prepend without refetch, mission filter narrowing, chip click callbacks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConductorActivityPanel, CONDUCTOR_RAW_MODE_KEY, CONDUCTOR_PAGE_SIZE } from './ConductorActivityPanel';

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
  it('shows the loading affordance and not the empty text while the fetch is unsettled', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as any;

    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    expect(screen.getByTestId('conductor-activity-loading')).toBeTruthy();
    expect(screen.queryByText('No conductor passes yet.')).toBeNull();
  });

  it('shows the empty text once the fetch resolves with zero rows', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rows: [] }),
      }),
    ) as any;

    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('No conductor passes yet.')).toBeTruthy();
      expect(screen.queryByTestId('conductor-activity-loading')).toBeNull();
    });
  });

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
        // A LIVE pass must be recent: isPassInflight gates on wall-clock age vs the node
        // timeout, so an epoch-era startedAt reads as 'killed', never 'live'.
        startedAt: Date.now() - 5_000,
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

  describe('conductor reasoning (summary)', () => {
    function mockRows(rows: any[], extra: Record<string, unknown> = {}) {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ rows, ...extra }) }),
      ) as any;
    }

    it('leads with the summary and demotes the mechanical sentence beneath it', async () => {
      mockRows([{ ...ROW_A, summary: 'Served crit-1 because the epic was the only unblocked path.' }]);

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      const summary = await screen.findByTestId('conductor-pass-summary');
      expect(summary.textContent).toContain('the only unblocked path');
      // The node's reasoning is the HERO: it precedes the mechanical sentence in the DOM,
      // and the sentence is still present as supporting detail.
      const sentence = screen.getByTestId('conductor-pass-sentence');
      expect(sentence.textContent).toContain('Mission mission-aaa');
      expect(summary.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('falls back to the sentence as the lead when a pass has no summary', async () => {
      mockRows([ROW_A]);

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId('conductor-pass-entry');
      expect(screen.queryByTestId('conductor-pass-summary')).toBeNull();
      // A row is never headed by nothing: the sentence takes the lead slot.
      expect(screen.getByTestId('conductor-pass-sentence').textContent).toContain('Mission mission-aaa');
    });

    it('renders no summary element for an explicitly null or whitespace-only summary', async () => {
      mockRows([
        { ...ROW_A, id: 'null-summary', summary: null },
        { ...ROW_B, id: 'blank-summary', summary: '   ' },
      ]);

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(2);
      });
      expect(screen.queryAllByTestId('conductor-pass-summary')).toHaveLength(0);
    });

    it('renders the summary on a DECLINED pass — the row that looks inert without it', async () => {
      mockRows([
        {
          ...ROW_A,
          id: 'pass-declined',
          criteriaActed: [],
          filed: [],
          declined: [{ what: 'redecompose', why: 'epic is built but unlanded' }],
          outcome: 'declined',
          summary: 'Declined the redecompose: the epic is built and only needs landing.',
        },
      ]);

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      const summary = await screen.findByTestId('conductor-pass-summary');
      expect(summary.textContent).toContain('only needs landing');
    });

    it('renders the summary on a pass that ran and filed nothing', async () => {
      mockRows([
        {
          ...ROW_A,
          id: 'pass-nofile',
          criteriaActed: [],
          filed: [],
          declined: [],
          outcome: 'conducted',
          ran: true,
          summary: 'Ran a full sweep and filed nothing: every criterion already has live work.',
        },
      ]);

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      const summary = await screen.findByTestId('conductor-pass-summary');
      expect(summary.textContent).toContain('filed nothing');
    });

    it('respects rawMode: the summary humanizes ids by default and shows them raw when toggled', async () => {
      const FULL = '12345678-90ab-cdef-1234-567890abcdef';
      mockRows(
        [{ ...ROW_A, id: 'pass-raw', summary: `Served via epic ${FULL}.` }],
        { nicknames: { [FULL]: 'happy-otter' } },
      );

      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      const summary = await screen.findByTestId('conductor-pass-summary');
      expect(summary.textContent).toContain('happy-otter');
      expect(summary.textContent).not.toContain(FULL);

      fireEvent.click(screen.getByTestId('conductor-raw-toggle'));
      await waitFor(() => {
        expect(screen.getByTestId('conductor-pass-summary').textContent).toContain(FULL);
      });
    });
  });

  describe('pagination', () => {
    /** Serves distinct rows per offset so the test can tell page 1 from page 2. */
    function mockPagedFetch(total: number) {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const offset = Number(new URLSearchParams(String(url).split('?')[1]).get('offset') ?? 0);
        const rows = Array.from({ length: Math.min(CONDUCTOR_PAGE_SIZE, Math.max(0, total - offset)) }, (_, i) => ({
          ...ROW_A,
          id: `row-${offset + i}`,
          missionId: 'mission-aaa',
          startedAt: 100000 - (offset + i),
          criteriaActed: [],
          outcome: `outcome-${offset + i}`,
        }));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows, total }) });
      });
      global.fetch = fetchMock as any;
      return fetchMock;
    }

    function lastUrl(fetchMock: any): string {
      return String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);
    }

    it('requests the first page with limit and offset=0 on mount', async () => {
      const fetchMock = mockPagedFetch(60);
      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(CONDUCTOR_PAGE_SIZE);
      });
      expect(lastUrl(fetchMock)).toContain(`limit=${CONDUCTOR_PAGE_SIZE}`);
      expect(lastUrl(fetchMock)).toContain('offset=0');
      expect(screen.getByTestId('conductor-page-label').textContent).toBe('page 1 of 3');
    });

    it('page 2 requests offset = one page and renders the second page of rows', async () => {
      const fetchMock = mockPagedFetch(60);
      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId('conductor-page-next');
      fireEvent.click(screen.getByTestId('conductor-page-next'));

      await waitFor(() => {
        expect(lastUrl(fetchMock)).toContain(`offset=${CONDUCTOR_PAGE_SIZE}`);
      });
      await waitFor(() => {
        expect(screen.getByTestId('conductor-page-label').textContent).toBe('page 2 of 3');
        expect(screen.getAllByTestId('conductor-pass-entry')[0].getAttribute('data-pass-id')).toBe(
          `row-${CONDUCTOR_PAGE_SIZE}`,
        );
      });
    });

    it('changing the mission filter resets to page 1', async () => {
      const fetchMock = mockPagedFetch(60);
      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId('conductor-page-next');
      fireEvent.click(screen.getByTestId('conductor-page-next'));
      await waitFor(() => {
        expect(screen.getByTestId('conductor-page-label').textContent).toBe('page 2 of 3');
      });

      fireEvent.change(screen.getByTestId('conductor-mission-filter'), {
        target: { value: 'mission-aaa' },
      });

      await waitFor(() => {
        expect(lastUrl(fetchMock)).toContain('offset=0');
        expect(lastUrl(fetchMock)).toContain('missionId=mission-aaa');
      });
      expect(screen.getByTestId('conductor-page-label').textContent).toBe('page 1 of 3');
    });

    it('live-prepends a WS row while on page 1', async () => {
      mockPagedFetch(60);
      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(CONDUCTOR_PAGE_SIZE);
      });

      capturedHandler!({ type: 'conductor_pass', project: 'proj1', row: ROW_WS });

      await waitFor(() => {
        expect(screen.getAllByTestId('conductor-pass-entry')[0].getAttribute('data-pass-id')).toBe('pass-ws1');
      });
      expect(screen.queryByTestId('conductor-pending-passes')).toBeNull();
    });

    it('does NOT prepend on page 2 — it holds the row behind an "N new passes" affordance', async () => {
      mockPagedFetch(60);
      render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

      await screen.findByTestId('conductor-page-next');
      fireEvent.click(screen.getByTestId('conductor-page-next'));
      await waitFor(() => {
        expect(screen.getByTestId('conductor-page-label').textContent).toBe('page 2 of 3');
      });

      const firstIdBefore = screen.getAllByTestId('conductor-pass-entry')[0].getAttribute('data-pass-id');
      capturedHandler!({ type: 'conductor_pass', project: 'proj1', row: ROW_WS });

      const pending = await screen.findByTestId('conductor-pending-passes');
      expect(pending.textContent).toContain('1 new pass');
      // The row the user was reading has NOT moved and the new row is not spliced in.
      expect(screen.getAllByTestId('conductor-pass-entry')[0].getAttribute('data-pass-id')).toBe(firstIdBefore);
      expect(screen.queryByText((_, el) => el?.getAttribute('data-pass-id') === 'pass-ws1')).toBeNull();

      fireEvent.click(pending);
      await waitFor(() => {
        expect(screen.getByTestId('conductor-page-label').textContent).toBe('page 1 of 3');
        expect(screen.queryByTestId('conductor-pending-passes')).toBeNull();
      });
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

describe('ConductorActivityPanel — operator-forced passes', () => {
  it('marks an operator-forced pass in the journal list, and leaves ordinary passes unmarked', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rows: [{ ...ROW_B, forced: true }, ROW_A] }),
      }),
    ) as any;

    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('conductor-pass-entry')).toHaveLength(2);
    });
    expect(screen.getAllByTestId('conductor-pass-forced')).toHaveLength(1);
    expect(screen.getByTestId('conductor-pass-forced').textContent).toBe('kicked');
  });
});
