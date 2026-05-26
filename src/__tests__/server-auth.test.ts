import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkAuth } from '../auth.js';

// checkAuth reads process.env.MERMAID_AUTH_TOKEN at call-time, so we just
// set/restore the env per case — no module resets needed.
function reqWith(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set('authorization', auth);
  return new Request('http://x/whatever', { headers });
}
const u = (p: string) => new URL(`http://x${p}`);

describe('checkAuth', () => {
  const orig = process.env.MERMAID_AUTH_TOKEN;
  beforeEach(() => delete process.env.MERMAID_AUTH_TOKEN);
  afterEach(() => {
    if (orig === undefined) delete process.env.MERMAID_AUTH_TOKEN;
    else process.env.MERMAID_AUTH_TOKEN = orig;
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
});
