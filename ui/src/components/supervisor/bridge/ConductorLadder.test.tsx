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

  it('shows the pass status line next to the relative time when idle', async () => {
    mockConductorWithPass(true, { reason: 'conducted', tickAt: Date.now() - 12_000, status: 'served a gap' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-last-pass')).toBeTruthy());
    expect(screen.getByTestId('conductor-status-line').textContent).toContain('served a gap');
    expect(screen.getByTestId('conductor-last-pass').textContent).toContain('12s ago');
  });

  it('hides the status line while a pass is in-flight (shows running…)', async () => {
    mockConductorWithPass(true, { reason: 'pass-ran', tickAt: Date.now(), status: 'running…' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-last-pass')).toBeTruthy());
    expect(screen.queryByTestId('conductor-status-line')).toBeNull();
    expect(screen.getByTestId('conductor-last-pass').textContent).toContain('running');
  });

  it('shows "interrupted" (not a stale "running…") for a pass that died mid-flight', async () => {
    // A killed pass (sidecar restart / watchdog) never stamped its terminal reason, so lastPass is
    // still reason:'pass-ran' with the literal status 'running…' — but STALE, so it is NOT running.
    mockConductorWithPass(true, { reason: 'pass-ran', tickAt: Date.now() - 10 * 60 * 1000, status: 'running…' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() => expect(screen.getByTestId('conductor-last-pass')).toBeTruthy());
    expect(screen.getByTestId('conductor-last-pass').getAttribute('data-running')).toBe('false');
    const line = screen.getByTestId('conductor-status-line').textContent ?? '';
    expect(line).toContain('interrupted');
    expect(line).not.toContain('running…');
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

/**
 * The operator KICK — the lightning bolt beside the on/off stops. One click arms exactly ONE
 * forced conductor pass (POST /api/conductor/kick); the flag is consumed by the pass that uses
 * it, so the control is a trigger, not a mode.
 */
describe('ConductorLadder — kick', () => {
  /** Conductor GET answers `enabled`, orchestrator GET answers `level`, and the kick POST is
   *  answered by `kickResponse`. Returns every kick POST body seen. */
  function mockWithKick(opts: { enabled: boolean; level?: string; kickResponse?: () => Promise<any> }) {
    const kicks: any[] = [];
    global.fetch = vi.fn((url: any, init?: any) => {
      if (String(url).includes('/api/conductor/kick')) {
        kicks.push(JSON.parse(init.body));
        return (opts.kickResponse ?? (() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })))();
      }
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, enabled: opts.enabled }) });
      }
      if (String(url).includes('/api/orchestrator/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: opts.level ?? 'drive' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: opts.enabled }) });
    }) as any;
    return kicks;
  }

  it('POSTs the kick for this project and reports success on the control', async () => {
    const kicks = mockWithKick({ enabled: true });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('conductor-kick'));

    await waitFor(() => {
      expect(screen.getByTestId('conductor-kick').getAttribute('data-kick-state')).toBe('ok');
    });
    expect(kicks).toEqual([{ project: '/abs/p' }]);
    expect(screen.getByTestId('conductor-kick').getAttribute('title')).toContain('kick armed');
  });

  it('locks the control while the kick is in flight, then re-enables it', async () => {
    let release: (v: any) => void = () => {};
    mockWithKick({ enabled: true, kickResponse: () => new Promise((res) => { release = res; }) });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('conductor-kick'));
    await waitFor(() => {
      expect(screen.getByTestId('conductor-kick').getAttribute('data-kick-state')).toBe('busy');
    });
    expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(true);

    release({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await waitFor(() =>
      expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('reports a FAILED kick on the control, using the server message', async () => {
    mockWithKick({
      enabled: true,
      kickResponse: () =>
        Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'project is required' }) }),
    });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('conductor-kick'));

    await waitFor(() => {
      expect(screen.getByTestId('conductor-kick').getAttribute('data-kick-state')).toBe('error');
    });
    expect(screen.getByTestId('conductor-kick').getAttribute('title')).toBe('project is required');
    expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports a network failure rather than throwing', async () => {
    mockWithKick({ enabled: true, kickResponse: () => Promise.reject(new Error('offline')) });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('conductor-kick'));

    await waitFor(() => {
      expect(screen.getByTestId('conductor-kick').getAttribute('data-kick-state')).toBe('error');
    });
    expect(screen.getByTestId('conductor-kick').getAttribute('title')).toContain('kick failed');
  });

  it('is disabled while the conductor is OFF — there is no pass to force', async () => {
    const kicks = mockWithKick({ enabled: false });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-enabled')).toBe('false'),
    );
    expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('conductor-kick'));
    expect(kicks).toEqual([]);
  });

  it('is disabled while the DAEMON is off — the conductor has nothing to drive', async () => {
    const kicks = mockWithKick({ enabled: true, level: 'off' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('conductor-ladder').getAttribute('data-daemon-off')).toBe('true'),
    );
    expect((screen.getByTestId('conductor-kick') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('conductor-kick'));
    expect(kicks).toEqual([]);
  });
});
