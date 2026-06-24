/**
 * DogfoodHealthPanel tests — UI-only; no live server. Mocks fetch + the websocket client.
 * Covers: (a) recurring rows render from mocked friction-trends payload;
 * (b) empty recurring → "No recurring friction." shown;
 * (c) unlanded count over threshold → amber CTA band appears; at/under → does not;
 * (d) stale-worktree count tile renders the mocked length.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DogfoodHealthPanel } from './DogfoodHealthPanel';

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

function mockFetchRouter(routes: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(match[1]) });
  });
}

const TRENDS_WITH_RECURRING = {
  total: 10,
  considered: 8,
  byLayer: [
    { layer: 'executor', count: 5, reasons: [] },
    { layer: 'gate', count: 3, reasons: [] },
  ],
  recurring: [
    { layer: 'executor', retryReason: 'tsc-typecheck-fail', count: 4 },
    { layer: 'gate', retryReason: 'lint-error', count: 2 },
  ],
};

const TRENDS_EMPTY = {
  total: 0,
  considered: 0,
  byLayer: [],
  recurring: [],
};

const UNLANDED_OVER = {
  unlandedEpics: [
    { branch: 'collab/epic/a', epicId8: 'aabbccdd', ahead: 3 },
    { branch: 'collab/epic/b', epicId8: 'bbccddee', ahead: 1 },
    { branch: 'collab/epic/c', epicId8: 'ccddeeff', ahead: 2 },
  ],
};

const UNLANDED_UNDER = {
  unlandedEpics: [
    { branch: 'collab/epic/a', epicId8: 'aabbccdd', ahead: 1 },
  ],
};

const STALE_TWO = {
  staleWorktrees: [
    { path: '/tmp/wt1', branch: 'collab/leaf/abc', reason: 'prunable', ageMs: 86400000 },
    { path: '/tmp/wt2', branch: 'collab/leaf/def', reason: 'stale', ageMs: 172800000 },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DogfoodHealthPanel', () => {
  it('renders recurring friction rows from mocked friction-trends', async () => {
    global.fetch = mockFetchRouter({
      'friction-trends': TRENDS_WITH_RECURRING,
      'unlanded-epics': UNLANDED_UNDER,
      'stale-worktrees': { staleWorktrees: [] },
    }) as any;
    render(<DogfoodHealthPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('dogfood-recurring')).toBeTruthy());
    const section = screen.getByTestId('dogfood-recurring');
    expect(section.textContent).toContain('tsc-typecheck-fail');
    expect(section.textContent).toContain('×4');
    expect(section.textContent).toContain('lint-error');
    expect(section.textContent).toContain('×2');
  });

  it('shows "No recurring friction." when recurring list is empty', async () => {
    global.fetch = mockFetchRouter({
      'friction-trends': TRENDS_EMPTY,
      'unlanded-epics': UNLANDED_UNDER,
      'stale-worktrees': { staleWorktrees: [] },
    }) as any;
    render(<DogfoodHealthPanel project="p" />);
    await waitFor(() => expect(screen.getByText('No recurring friction.')).toBeTruthy());
    expect(screen.queryByText('recurring friction')).toBeNull();
  });

  it('shows amber CTA band when unlanded count exceeds threshold', async () => {
    global.fetch = mockFetchRouter({
      'friction-trends': TRENDS_EMPTY,
      'unlanded-epics': UNLANDED_OVER,
      'stale-worktrees': { staleWorktrees: [] },
    }) as any;
    render(<DogfoodHealthPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('dogfood-unlanded-cta')).toBeTruthy());
    const cta = screen.getByTestId('dogfood-unlanded-cta');
    expect(cta.textContent).toContain('stranded off master');
    expect(cta.className).toContain('amber');
  });

  it('does NOT show CTA band when unlanded count is at or under threshold', async () => {
    global.fetch = mockFetchRouter({
      'friction-trends': TRENDS_EMPTY,
      'unlanded-epics': UNLANDED_UNDER,
      'stale-worktrees': { staleWorktrees: [] },
    }) as any;
    render(<DogfoodHealthPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('dogfood-unlanded')).toBeTruthy());
    expect(screen.queryByTestId('dogfood-unlanded-cta')).toBeNull();
  });

  it('renders stale worktree count from mocked stale-worktrees', async () => {
    global.fetch = mockFetchRouter({
      'friction-trends': TRENDS_EMPTY,
      'unlanded-epics': UNLANDED_UNDER,
      'stale-worktrees': STALE_TWO,
    }) as any;
    render(<DogfoodHealthPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('dogfood-stale-worktrees')).toBeTruthy());
    expect(screen.getByTestId('dogfood-stale-worktrees').textContent).toBe('2');
  });
});
