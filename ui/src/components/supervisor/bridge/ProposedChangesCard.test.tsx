/**
 * ProposedChangesCard tests — UI-only; no live executor. Mocks fetch and the websocket
 * client. Covers: (a) a manifest with one create + one edit → two proposed-file rows with
 * the correct prefix/colour; (b) ran:false → renders nothing (hidden); (c) empty lists →
 * renders nothing (hidden).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProposedChangesCard } from './ProposedChangesCard';

// The card subscribes to ws nudges; stub a no-op client so no real socket opens.
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

function mockFetchOnce(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProposedChangesCard', () => {
  it('renders create + edit rows with correct prefix and colour', async () => {
    global.fetch = mockFetchOnce({
      leafId: 't1',
      blueprintId: 'doc-1',
      manifest: { filesToCreate: ['a/new.ts'], filesToEdit: ['b/old.ts'] },
    }) as any;
    render(<ProposedChangesCard leafId="t1" project="proj" />);
    await waitFor(() => expect(screen.getAllByTestId('proposed-file')).toHaveLength(2));

    const create = screen.getByText('a/new.ts').closest('[data-testid="proposed-file"]')!;
    expect(create.textContent).toContain('+');
    expect(create.querySelector('.text-green-600')).toBeTruthy();

    const edit = screen.getByText('b/old.ts').closest('[data-testid="proposed-file"]')!;
    expect(edit.textContent).toContain('~');
    expect(edit.querySelector('.text-amber-600')).toBeTruthy();
  });

  it('ran:false → renders nothing (hidden)', async () => {
    global.fetch = mockFetchOnce({ leafId: 't1', ran: false }) as any;
    const { container } = render(<ProposedChangesCard leafId="t1" project="proj" />);
    await waitFor(() => expect(screen.queryByTestId('proposed-changes-card')).toBeNull());
    expect(container.firstChild).toBeNull();
  });

  it('empty manifest lists → renders nothing (hidden)', async () => {
    global.fetch = mockFetchOnce({
      leafId: 't1',
      blueprintId: 'doc-1',
      manifest: { filesToCreate: [], filesToEdit: [] },
    }) as any;
    const { container } = render(<ProposedChangesCard leafId="t1" project="proj" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('proposed-changes-card')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
