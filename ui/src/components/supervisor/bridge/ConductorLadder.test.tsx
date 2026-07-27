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

  it('disables the switch when the daemon is off (conductor depends on the daemon)', async () => {
    const post = vi.fn();
    global.fetch = vi.fn((url: any, init?: any) => {
      if (init?.method === 'POST') { post(); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); }
      if (String(url).includes('/api/orchestrator/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false }) });
    }) as any;
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-daemon-off')).toBe('true'),
    );
    expect((screen.getByTestId('conductor-stop-on') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('conductor-stop-on'));
    await new Promise((r) => setTimeout(r, 10));
    expect(post).not.toHaveBeenCalled(); // can't enable the conductor while the daemon is off
  });

  /** Conductor GET returns enabled + a lastPass heartbeat; other GETs are inert. */
  function mockConductorWithPass(enabled: boolean, lastPass: Record<string, unknown>) {
    global.fetch = vi.fn((url: any) => {
      if (String(url).includes('/api/supervisor/conductor')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled, lastPass }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;
  }

  it('shows an amber pulsing dot + "running…" while a pass is in-flight', async () => {
    mockConductorWithPass(true, { reason: 'pass-ran', tickAt: Date.now() });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-last-pass')).toBeTruthy());
    expect(screen.getByTestId('conductor-run-dot').className).toContain('bg-warning-500');
    expect(screen.getByTestId('conductor-run-dot').className).toContain('animate-pulse');
    const readout = screen.getByTestId('conductor-last-pass');
    expect(readout.getAttribute('data-running')).toBe('true');
    expect(readout.textContent).toContain('running');
  });

  it('shows a green dot + the previous-run relative time when idle', async () => {
    mockConductorWithPass(true, { reason: 'building-wait', tickAt: Date.now() - 120_000 });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-last-pass')).toBeTruthy());
    expect(screen.getByTestId('conductor-run-dot').className).toContain('bg-success-500');
    const readout = screen.getByTestId('conductor-last-pass');
    expect(readout.getAttribute('data-running')).toBe('false');
    expect(readout.textContent).toContain('2m ago');
  });

  it('treats a STALE pass-ran heartbeat as not running (green, not amber)', async () => {
    mockConductorWithPass(true, { reason: 'pass-ran', tickAt: Date.now() - 10 * 60 * 1000 });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-last-pass')).toBeTruthy());
    expect(screen.getByTestId('conductor-run-dot').className).toContain('bg-success-500');
    expect(screen.getByTestId('conductor-last-pass').getAttribute('data-running')).toBe('false');
  });

  it('shows no run-dot or readout when the conductor is off', async () => {
    mockConductorWithPass(false, { reason: 'pass-ran', tickAt: Date.now() });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-ladder')).toBeTruthy());
    expect(screen.queryByTestId('conductor-run-dot')).toBeNull();
    expect(screen.queryByTestId('conductor-last-pass')).toBeNull();
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
