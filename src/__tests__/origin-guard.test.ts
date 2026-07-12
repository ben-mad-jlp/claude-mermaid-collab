import { describe, it, expect } from 'bun:test';
import { isAllowedOrigin } from '../services/origin-guard.ts';

const reqWith = (path: string, origin?: string, host?: string) =>
  new Request(`http://x${path}`, {
    headers: {
      ...(origin ? { origin } : {}),
      ...(host ? { host } : {}),
    },
  });

describe('isAllowedOrigin', () => {
  it('allows requests with NO Origin header (native clients)', () => {
    const req = reqWith('/api/foo');
    const url = new URL('http://x/api/foo');
    expect(isAllowedOrigin(req, url)).toBe(true);
  });

  it('allows same-origin requests', () => {
    const req = reqWith('/api/foo', 'http://192.168.1.5:9002', '192.168.1.5:9002');
    const url = new URL('http://x/api/foo');
    expect(isAllowedOrigin(req, url)).toBe(true);
  });

  it('rejects foreign origins on /api routes', () => {
    const req = reqWith('/api/foo', 'http://evil.example', '192.168.1.5:9002');
    const url = new URL('http://x/api/foo');
    expect(isAllowedOrigin(req, url)).toBe(false);
  });

  it('rejects foreign origins on /ws upgrade', () => {
    const req = reqWith('/ws', 'http://evil.example', '192.168.1.5:9002');
    const url = new URL('http://x/ws');
    expect(isAllowedOrigin(req, url)).toBe(false);
  });

  it('exempts /api/health from origin check', () => {
    const req = reqWith('/api/health', 'http://evil.example', '192.168.1.5:9002');
    const url = new URL('http://x/api/health');
    expect(isAllowedOrigin(req, url)).toBe(true);
  });

  it('exempts /mcp from origin check', () => {
    const req = reqWith('/mcp', 'http://evil.example', '192.168.1.5:9002');
    const url = new URL('http://x/mcp');
    expect(isAllowedOrigin(req, url)).toBe(true);
  });

  it('exempts /mcp/* from origin check', () => {
    const req = reqWith('/mcp/x', 'http://evil.example', '192.168.1.5:9002');
    const url = new URL('http://x/mcp/x');
    expect(isAllowedOrigin(req, url)).toBe(true);
  });

  it('allows loopback origins even with different Host spelling', () => {
    const req = reqWith('/api/foo', 'http://localhost:9002', '127.0.0.1:9002');
    const url = new URL('http://x/api/foo');
    expect(isAllowedOrigin(req, url)).toBe(true);
  });

  it('rejects malformed Origin header', () => {
    const req = reqWith('/api/foo', 'not a url', '192.168.1.5:9002');
    const url = new URL('http://x/api/foo');
    expect(isAllowedOrigin(req, url)).toBe(false);
  });
});
