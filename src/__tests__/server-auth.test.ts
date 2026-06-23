import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkAuth, isLoopbackPeer } from '../auth.js';
import { _resetConfigCache } from '../services/config-file.js';

// checkAuth now resolves the token config-FIRST (getAuthToken). Point the config
// file at a non-existent path so these cases are hermetic — the token comes only
// from the per-case env var, never a real ~/.mermaid-collab/config.json.
const PRIOR_CONFIG_PATH = process.env.MERMAID_CONFIG_PATH;
function reqWith(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set('authorization', auth);
  return new Request('http://x/whatever', { headers });
}
const u = (p: string) => new URL(`http://x${p}`);

describe('checkAuth', () => {
  const orig = process.env.MERMAID_AUTH_TOKEN;
  beforeEach(() => {
    delete process.env.MERMAID_AUTH_TOKEN;
    process.env.MERMAID_CONFIG_PATH = '/tmp/mermaid-collab-test-nonexistent-config.json';
    _resetConfigCache();
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.MERMAID_AUTH_TOKEN;
    else process.env.MERMAID_AUTH_TOKEN = orig;
    if (PRIOR_CONFIG_PATH === undefined) delete process.env.MERMAID_CONFIG_PATH;
    else process.env.MERMAID_CONFIG_PATH = PRIOR_CONFIG_PATH;
    _resetConfigCache();
  });

  it('allows everything when no token is configured', () => {
    expect(checkAuth(reqWith(), u('/api/diagrams'))).toBeNull();
    expect(checkAuth(reqWith(), u('/ws'))).toBeNull();
  });

  it('401s a request with no Authorization header when a token is set', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    const res = checkAuth(reqWith(), u('/api/diagrams'));
    expect(res?.status).toBe(401);
  });

  it('401s a wrong token', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith('Bearer nope'), u('/api/diagrams'))?.status).toBe(401);
  });

  it('allows a correct Bearer token', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith('Bearer sekret'), u('/api/diagrams'))).toBeNull();
  });

  it('exempts /api/health even with a token set and no header', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith(), u('/api/health'))).toBeNull();
  });

  it('exempts /mcp and sub-paths', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith(), u('/mcp'))).toBeNull();
    expect(checkAuth(reqWith(), u('/mcp/messages'))).toBeNull();
  });

  // Mobile-app v1: loopback peers (the desktop UI / local MCP) stay tokenless even
  // when a token is configured; only non-loopback peers must present it.
  it('exempts a loopback peer with no header even when a token is set', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith(), u('/api/diagrams'), '127.0.0.1')).toBeNull();
    expect(checkAuth(reqWith(), u('/api/diagrams'), '::1')).toBeNull();
    expect(checkAuth(reqWith(), u('/api/diagrams'), '::ffff:127.0.0.1')).toBeNull();
  });

  it('401s a non-loopback peer (the phone) with no token', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith(), u('/api/diagrams'), '100.88.1.2')?.status).toBe(401);
  });

  it('allows a non-loopback peer that presents the correct token', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith('Bearer sekret'), u('/api/diagrams'), '100.88.1.2')).toBeNull();
  });

  it('an unresolved peer (undefined) is treated as remote — fail safe', () => {
    process.env.MERMAID_AUTH_TOKEN = 'sekret';
    expect(checkAuth(reqWith(), u('/api/diagrams'), undefined)?.status).toBe(401);
  });
});

describe('isLoopbackPeer', () => {
  it('recognizes IPv4/IPv6 loopback incl. mapped form', () => {
    expect(isLoopbackPeer('127.0.0.1')).toBe(true);
    expect(isLoopbackPeer('127.5.5.5')).toBe(true);
    expect(isLoopbackPeer('::1')).toBe(true);
    expect(isLoopbackPeer('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects tailnet / lan / undefined', () => {
    expect(isLoopbackPeer('100.88.1.2')).toBe(false); // tailnet CGNAT
    expect(isLoopbackPeer('192.168.1.5')).toBe(false);
    expect(isLoopbackPeer(undefined)).toBe(false);
    expect(isLoopbackPeer(null)).toBe(false);
    expect(isLoopbackPeer('')).toBe(false);
  });
});
