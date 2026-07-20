import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConductorLadder } from './ConductorLadder';

afterEach(() => vi.restoreAllMocks());

/** Mock the conductor GET; capture any POST. */
function mockConductor(enabled: boolean) {
  const post = vi.fn();
  global.fetch = vi.fn((url: any, init?: any) => {
    if (init?.method === 'POST') {
      post(JSON.parse(init.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, enabled: JSON.parse(init.body).enabled }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled }) });
  }) as any;
  return { post };
}

describe('ConductorLadder', () => {
  it('renders the off·on stops labelled "Conductor"', async () => {
    mockConductor(false);
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-ladder')).toBeTruthy());
    expect(screen.getByTestId('conductor-stop-off')).toBeTruthy();
    expect(screen.getByTestId('conductor-stop-on')).toBeTruthy();
    expect(screen.getByText('Conductor')).toBeTruthy();
  });

  it('marks the ON stop active when the conductor is enabled', async () => {
    mockConductor(true);
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-enabled')).toBe('true'),
    );
    expect(screen.getByTestId('conductor-stop-on').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('conductor-stop-off').getAttribute('data-active')).toBe('false');
  });

  it('POSTs { enabled: true } when the ON stop is clicked (interactive, unlike the old badge)', async () => {
    const { post } = mockConductor(false);
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-enabled')).toBe('false'),
    );
    fireEvent.click(screen.getByTestId('conductor-stop-on'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith({ project: '/abs/p', enabled: true });
  });

  it('does not POST when the already-active stop is clicked', async () => {
    const { post } = mockConductor(true);
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-enabled')).toBe('true'),
    );
    fireEvent.click(screen.getByTestId('conductor-stop-on')); // already on → no-op
    // Give any (unexpected) POST a tick to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(post).not.toHaveBeenCalled();
  });
});
