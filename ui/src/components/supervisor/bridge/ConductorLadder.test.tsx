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

/**
 * AUTOFIX — the THIRD operator lever, beside the conductor stops and the kick. It holds the
 * daemon's repair-forge pass (the only pass that spends nodes without a human asking).
 * Default 'on': the forge runs today, so this is an explicit opt-OUT.
 */
describe('ConductorLadder — AutoFix switch', () => {
  /** Conductor GET answers `enabled`; the AutoFix GET answers `level`; the AutoFix POST is
   *  answered by `postResponse`. Returns every AutoFix POST body seen. */
  function mockWithAutoFix(opts: {
    enabled?: boolean;
    autoFix?: string;
    postResponse?: (body: any) => Promise<any>;
  }) {
    const posts: any[] = [];
    global.fetch = vi.fn((url: any, init?: any) => {
      if (String(url).includes('/api/autofix/level')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body);
          posts.push(body);
          return (opts.postResponse ?? (() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({ level: body.level }) })))(body);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: opts.autoFix ?? 'on' }) });
      }
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url).includes('/api/orchestrator/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: opts.enabled ?? true }) });
    }) as any;
    return posts;
  }

  it('renders the CURRENT level read on mount (off)', async () => {
    mockWithAutoFix({ autoFix: 'off' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('off'),
    );
    expect(screen.getByTestId('autofix-level').textContent).toContain('off');
  });

  it('renders ON when the server reports on', async () => {
    mockWithAutoFix({ autoFix: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('on'),
    );
    expect(screen.getByTestId('autofix-level').textContent).toContain('on');
  });

  it('POSTs the FLIPPED level on click and adopts the server value', async () => {
    const posts = mockWithAutoFix({ autoFix: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('on'),
    );

    fireEvent.click(screen.getByTestId('autofix-toggle'));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts).toEqual([{ project: '/abs/p', level: 'off' }]);
    await waitFor(() =>
      expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('off'),
    );
  });

  it('DISABLES the control while the write is in flight, then re-enables it', async () => {
    let release: ((v: any) => void) | null = null;
    const posts = mockWithAutoFix({
      autoFix: 'on',
      postResponse: () => new Promise((resolve) => { release = resolve; }),
    });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('autofix-toggle') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('autofix-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-busy')).toBe('true'),
    );
    expect((screen.getByTestId('autofix-toggle') as HTMLButtonElement).disabled).toBe(true);

    // A second click while in flight must not queue another write.
    fireEvent.click(screen.getByTestId('autofix-toggle'));
    expect(posts.length).toBe(1);

    release!({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
    await waitFor(() =>
      expect((screen.getByTestId('autofix-toggle') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('surfaces a FAILED write inline, using the server message, and does not flip the level', async () => {
    mockWithAutoFix({
      autoFix: 'on',
      postResponse: () =>
        Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'level must be one of: off, on' }) }),
    });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('on'),
    );

    fireEvent.click(screen.getByTestId('autofix-toggle'));

    await waitFor(() => expect(screen.getByTestId('autofix-error')).toBeTruthy());
    expect(screen.getByTestId('autofix-error').textContent).toContain('level must be one of: off, on');
    // The switch still reads what the server actually holds — a failed write never flips it.
    expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('on');
  });

  it('surfaces a NETWORK failure inline rather than throwing', async () => {
    mockWithAutoFix({ autoFix: 'on', postResponse: () => Promise.reject(new Error('offline')) });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('autofix-toggle') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('autofix-toggle'));

    await waitFor(() => expect(screen.getByTestId('autofix-error')).toBeTruthy());
    expect(screen.getByTestId('autofix-error').textContent).toContain('autofix failed');
  });
});

/**
 * EXPLORER — the FOURTH operator lever. It holds explore-leaf DISPATCH only: explores are
 * still filed and still promoted into the 'Explore runs' epic while it is off, so nothing
 * is lost; flipping it back on drains the queue. Default 'on'.
 */
describe('ConductorLadder — Explorer switch', () => {
  function mockWithExplorer(opts: { explorer?: string; postResponse?: (body: any) => Promise<any> }) {
    const posts: any[] = [];
    global.fetch = vi.fn((url: any, init?: any) => {
      if (String(url).includes('/api/explorer/level')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body);
          posts.push(body);
          return (opts.postResponse ?? (() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({ level: body.level }) })))(body);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: opts.explorer ?? 'on' }) });
      }
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url).includes('/api/orchestrator/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true, level: 'on' }) });
    }) as any;
    return posts;
  }

  it('renders the CURRENT level read on mount (off)', async () => {
    mockWithExplorer({ explorer: 'off' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('off'),
    );
    expect(screen.getByTestId('explorer-level').textContent).toContain('off');
  });

  it('renders ON when the server reports on (the default)', async () => {
    mockWithExplorer({ explorer: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('on'),
    );
    expect(screen.getByTestId('explorer-level').textContent).toContain('on');
  });

  it('POSTs the FLIPPED level on click and adopts the server value', async () => {
    const posts = mockWithExplorer({ explorer: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('on'),
    );

    fireEvent.click(screen.getByTestId('explorer-toggle'));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts).toEqual([{ project: '/abs/p', level: 'off' }]);
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('off'),
    );
  });

  it('DISABLES the control while the write is in flight, then re-enables it', async () => {
    let release: ((v: any) => void) | null = null;
    const posts = mockWithExplorer({
      explorer: 'on',
      postResponse: () => new Promise((resolve) => { release = resolve; }),
    });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('explorer-toggle') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('explorer-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-busy')).toBe('true'),
    );
    expect((screen.getByTestId('explorer-toggle') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('explorer-toggle')); // no double-write while in flight
    expect(posts.length).toBe(1);

    release!({ ok: true, json: () => Promise.resolve({ level: 'off' }) });
    await waitFor(() =>
      expect((screen.getByTestId('explorer-toggle') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('surfaces a FAILED write inline and does not flip the level', async () => {
    mockWithExplorer({
      explorer: 'on',
      postResponse: () =>
        Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'level must be one of: off, on' }) }),
    });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('on'),
    );

    fireEvent.click(screen.getByTestId('explorer-toggle'));

    await waitFor(() => expect(screen.getByTestId('explorer-error')).toBeTruthy());
    expect(screen.getByTestId('explorer-error').textContent).toContain('level must be one of: off, on');
    expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('on');
  });

  it('surfaces a NETWORK failure inline rather than throwing', async () => {
    mockWithExplorer({ explorer: 'on', postResponse: () => Promise.reject(new Error('offline')) });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect((screen.getByTestId('explorer-toggle') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('explorer-toggle'));

    await waitFor(() => expect(screen.getByTestId('explorer-error')).toBeTruthy());
    expect(screen.getByTestId('explorer-error').textContent).toContain('explorer failed');
  });

  it('AutoFix and Explorer are INDEPENDENT stops — flipping one does not post the other', async () => {
    const bodies: any[] = [];
    global.fetch = vi.fn((url: any, init?: any) => {
      if (init?.method === 'POST') {
        bodies.push({ url: String(url), body: JSON.parse(init.body) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: JSON.parse(init.body).level }) });
      }
      if (String(url).includes('/api/autofix/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
      }
      if (String(url).includes('/api/explorer/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
      }
      if (String(url).includes('/api/orchestrator/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true }) });
    }) as any;

    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('explorer-toggle').getAttribute('data-lever-level')).toBe('on'),
    );
    fireEvent.click(screen.getByTestId('explorer-toggle'));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].url).toContain('/api/explorer/level');
    // The AutoFix stop is untouched and still reads 'on'.
    expect(screen.getByTestId('autofix-toggle').getAttribute('data-lever-level')).toBe('on');
  });
});

describe('ConductorLadder campaign lever (the spend kill switch)', () => {
  /** Route the campaign lever's GET/POST; everything else answers generically. */
  function mockWithCampaign(opts: { campaign?: string }) {
    const posts: any[] = [];
    global.fetch = vi.fn((url: any, init?: any) => {
      if (String(url).includes('/api/campaign/level')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body);
          posts.push(body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: body.level }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: opts.campaign ?? 'on' }) });
      }
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url).includes('/api/orchestrator/level')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 'on' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: true }) });
    }) as any;
    return posts;
  }

  it('renders a Campaign stop next to the conductor controls with the level read on mount', async () => {
    mockWithCampaign({ campaign: 'off' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-toggle').getAttribute('data-lever-level')).toBe('off'),
    );
    expect(screen.getByTestId('campaign-level').textContent).toContain('Campaign');
    expect(screen.getByTestId('campaign-level').textContent).toContain('off');
  });

  it('POSTs the flipped campaign level on click and adopts the server value', async () => {
    const posts = mockWithCampaign({ campaign: 'on' });
    render(<ConductorLadder project="/abs/p" />);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-toggle').getAttribute('data-lever-level')).toBe('on'),
    );

    fireEvent.click(screen.getByTestId('campaign-toggle'));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts).toEqual([{ project: '/abs/p', level: 'off' }]);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-toggle').getAttribute('data-lever-level')).toBe('off'),
    );
  });
});
