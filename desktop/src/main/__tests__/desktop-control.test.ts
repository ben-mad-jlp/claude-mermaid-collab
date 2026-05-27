import { describe, it, expect, vi, afterEach } from 'vitest';
import { DesktopControl } from '../desktop-control';

// server-supervisor imports only node:net and node:child_process — no electron.
// We mock getFreePort to avoid OS port scanning in tests and to get a
// deterministic port that we know will be free (we let the OS pick one via
// net.createServer listen on port 0, then close and use that port).
vi.mock('../server-supervisor', () => ({
  getFreePort: async () => {
    const net = await import('node:net');
    return new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as net.AddressInfo;
        srv.close(() => resolve(addr.port));
      });
      srv.once('error', reject);
    });
  },
}));

function makePaneManager() {
  return {
    ensureSessionTab: vi.fn(async (_session: string) => ({ id: 'x' })),
  };
}

describe('DesktopControl', () => {
  let control: DesktopControl;

  afterEach(async () => {
    await control?.stop();
  });

  it('start() returns {url, token}', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url, token } = await control.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('POST /panes/ensure with correct Bearer token → 200 {ok:true}, ensureSessionTab called', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url, token } = await control.start();

    const res = await fetch(`${url}/panes/ensure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session: 's' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(paneManager.ensureSessionTab).toHaveBeenCalledOnce();
    expect(paneManager.ensureSessionTab).toHaveBeenCalledWith('s');
  });

  it('POST with wrong token → 401, ensureSessionTab NOT called', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url } = await control.start();

    const res = await fetch(`${url}/panes/ensure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ session: 's' }),
    });

    expect(res.status).toBe(401);
    expect(paneManager.ensureSessionTab).not.toHaveBeenCalled();
  });

  it('POST with no token → 401, ensureSessionTab NOT called', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url } = await control.start();

    const res = await fetch(`${url}/panes/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 's' }),
    });

    expect(res.status).toBe(401);
    expect(paneManager.ensureSessionTab).not.toHaveBeenCalled();
  });

  it('POST /panes/ensure with no session in body → 400', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url, token } = await control.start();

    const res = await fetch(`${url}/panes/ensure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ notSession: 'oops' }),
    });

    expect(res.status).toBe(400);
    expect(paneManager.ensureSessionTab).not.toHaveBeenCalled();
  });

  it('GET / → 404', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url } = await control.start();

    const res = await fetch(`${url}/`);
    expect(res.status).toBe(404);
  });

  it('POST /other/path → 404', async () => {
    const paneManager = makePaneManager();
    control = new DesktopControl(paneManager as any);
    const { url, token } = await control.start();

    const res = await fetch(`${url}/other/path`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});
