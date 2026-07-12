import { describe, it, expect, mock } from 'bun:test';

mock.module('../services/config-file.ts', () => ({
  getAuthToken: () => 'secret-token',
}));

const { checkAuth } = await import('../auth.ts');

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
