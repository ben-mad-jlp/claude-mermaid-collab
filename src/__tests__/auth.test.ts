import { describe, it, expect, mock, beforeEach } from 'bun:test';

let requireAuthOnLoopbackFlag = false;
mock.module('../services/config-file.ts', () => ({
  getAuthToken: () => 'secret-token',
  getRequireAuthOnLoopback: () => requireAuthOnLoopbackFlag,
}));

const { checkAuth } = await import('../auth.ts');
const { apiFetch } = await import('../mcp/tools/http-util.ts');

beforeEach(() => {
  requireAuthOnLoopbackFlag = false;
});

const withToken = (t?: string) =>
  new Request('http://x/api/foo', t ? { headers: { authorization: `Bearer ${t}` } } : undefined);
const url = new URL('http://x/api/foo');

describe('checkAuth LAN-only enforcement', () => {
  it('rejects a public peer with 403 even WITH a valid token', () => {
    for (const peer of ['8.8.8.8', '::ffff:8.8.8.8']) {
      const r = checkAuth(withToken('secret-token'), url, peer);
      expect(r).not.toBeNull();
      expect(r!.status).toBe(403);
    }
  });

  it('allows an RFC1918 peer WITH a valid token (null)', () => {
    for (const peer of ['192.168.1.50', '10.0.0.2', '172.16.0.9', '::ffff:192.168.1.50']) {
      expect(checkAuth(withToken('secret-token'), url, peer)).toBeNull();
    }
  });

  it('401s an RFC1918 peer WITHOUT / with wrong token', () => {
    expect(checkAuth(withToken(), url, '192.168.1.50')!.status).toBe(401);
    expect(checkAuth(withToken('nope'), url, '10.0.0.2')!.status).toBe(401);
  });

  it('allows a loopback peer tokenless (unchanged)', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(checkAuth(withToken(), url, peer)).toBeNull();
    }
  });

  it('treats a null/undefined peer as remote → 403', () => {
    expect(checkAuth(withToken('secret-token'), url, undefined)!.status).toBe(403);
    expect(checkAuth(withToken('secret-token'), url, null)!.status).toBe(403);
  });

  it('keeps /api/health and /mcp exempt', () => {
    const h = new URL('http://x/api/health');
    expect(checkAuth(withToken(), h, '8.8.8.8')).toBeNull();
    const m = new URL('http://x/mcp/session');
    expect(checkAuth(withToken(), m, '8.8.8.8')).toBeNull();
  });
});

describe('checkAuth requireAuthOnLoopback mode', () => {
  it('mode on: 401s a tokenless loopback peer on /api/foo', () => {
    requireAuthOnLoopbackFlag = true;
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(checkAuth(withToken(), url, peer)!.status).toBe(401);
    }
  });

  it('mode on: 401s a tokenless loopback peer on /mcp', () => {
    requireAuthOnLoopbackFlag = true;
    const m = new URL('http://x/mcp/session');
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(checkAuth(withToken(), m, peer)!.status).toBe(401);
    }
  });

  it('mode on: allows a loopback peer WITH the correct token on /api/foo and /mcp', () => {
    requireAuthOnLoopbackFlag = true;
    const m = new URL('http://x/mcp/session');
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(checkAuth(withToken('secret-token'), url, peer)).toBeNull();
      expect(checkAuth(withToken('secret-token'), m, peer)).toBeNull();
    }
  });

  it('mode on: LAN gate is untouched — RFC1918 with token passes, without token 401s, public peer 403s', () => {
    requireAuthOnLoopbackFlag = true;
    expect(checkAuth(withToken('secret-token'), url, '192.168.1.50')).toBeNull();
    expect(checkAuth(withToken(), url, '192.168.1.50')!.status).toBe(401);
    expect(checkAuth(withToken('secret-token'), url, '8.8.8.8')!.status).toBe(403);
  });

  it('mode off: LAN gate is untouched — RFC1918 with token passes, without token 401s, public peer 403s', () => {
    requireAuthOnLoopbackFlag = false;
    expect(checkAuth(withToken('secret-token'), url, '192.168.1.50')).toBeNull();
    expect(checkAuth(withToken(), url, '192.168.1.50')!.status).toBe(401);
    expect(checkAuth(withToken('secret-token'), url, '8.8.8.8')!.status).toBe(403);
  });
});

describe('apiFetch header passes checkAuth', () => {
  it('mode on: a request carrying the header apiFetch attaches passes checkAuth on a loopback peer', async () => {
    requireAuthOnLoopbackFlag = true;
    const originalFetch = globalThis.fetch;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response('ok'));
    }) as unknown) as typeof fetch;
    try {
      await apiFetch('http://x/api/foo');
    } finally {
      globalThis.fetch = originalFetch;
    }
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');

    const req = new Request('http://x/api/foo', { headers });
    expect(checkAuth(req, url, '127.0.0.1')).toBeNull();
    expect(checkAuth(withToken(), url, '127.0.0.1')!.status).toBe(401);
  });

  it('mode off: a tokenless loopback request still passes checkAuth regardless of apiFetch\'s header', () => {
    requireAuthOnLoopbackFlag = false;
    expect(checkAuth(withToken(), url, '127.0.0.1')).toBeNull();
  });
});
