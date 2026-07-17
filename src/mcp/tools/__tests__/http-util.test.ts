import { describe, it, expect, mock } from 'bun:test';

let token = '';
mock.module('../../../services/config-file.ts', () => ({
  getAuthToken: () => token,
}));

const { apiFetch } = await import('../http-util.ts');

function stubFetch(): { calls: Array<{ url: string; init?: RequestInit }>; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (mock((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('ok'));
  }) as unknown) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

describe('apiFetch', () => {
  it('attaches an authorization: Bearer <token> header when a token is configured', async () => {
    token = 'secret-token';
    const { calls, restore } = stubFetch();
    try {
      await apiFetch('http://x/api/foo');
    } finally {
      restore();
    }
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
  });

  it('omits the authorization header when the token is empty', async () => {
    token = '';
    const { calls, restore } = stubFetch();
    try {
      await apiFetch('http://x/api/foo');
    } finally {
      restore();
    }
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it('preserves an existing init.headers value alongside the injected authorization header', async () => {
    token = 'secret-token';
    const { calls, restore } = stubFetch();
    try {
      await apiFetch('http://x/api/foo', { headers: { 'content-type': 'application/json' } });
    } finally {
      restore();
    }
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer secret-token');
  });
});
