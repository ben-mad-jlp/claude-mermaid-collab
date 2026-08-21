/**
 * The pairing payload must source per-server tokens from the Electron main process.
 *
 * `servers.json` seals a peer's credential as `encryptedToken` (OS keystore), so the
 * sidecar reading that file gets entries with NO token. The old fallback then advertised
 * peers with THIS server's token; the phone was rejected by that peer and unpaired itself
 * in a loop (2026-08-21). Main serves the real tokens over the loopback control channel.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePairRoutes } from '../pair-routes.ts';

let dir: string;
let originalFetch: typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pair-fleet-'));
  process.env.MERMAID_CONFIG_PATH = join(dir, 'config.json');
  process.env.MERMAID_TAILNET_HOST = 'self.tail445728.ts.net';
  // On-disk fleet: the remote entry has NO token, exactly as the sealed file presents it.
  const f = join(dir, 'servers.json');
  writeFileSync(f, JSON.stringify({
    entries: [
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
      { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002 },
    ],
    forgotten: [],
  }));
  process.env.MERMAID_DESKTOP_SERVERS_FILE = f;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MC_DESKTOP_CONTROL_URL;
  delete process.env.MC_DESKTOP_CONTROL_TOKEN;
  delete process.env.MERMAID_DESKTOP_SERVERS_FILE;
  delete process.env.MERMAID_TAILNET_HOST;
  rmSync(dir, { recursive: true, force: true });
});

async function servers(): Promise<any[]> {
  const res = await handlePairRoutes(
    new Request('http://x/api/pair'),
    new URL('http://x/api/pair'),
    '127.0.0.1'
  );
  return ((await res!.json()) as any).servers;
}

describe('pairing payload fleet source', () => {
  it('uses the per-server tokens main supplies over the control channel', async () => {
    process.env.MC_DESKTOP_CONTROL_URL = 'http://127.0.0.1:1';
    process.env.MC_DESKTOP_CONTROL_TOKEN = 'ctl';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        servers: [
          { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
          { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002, token: 'tok-rem' },
        ],
      }), { status: 200 })) as unknown as typeof fetch;

    const list = await servers();
    expect(list.find((s) => s.id === 'rem').token).toBe('tok-rem');
  });

  it('presents the control token request with a bearer header', async () => {
    process.env.MC_DESKTOP_CONTROL_URL = 'http://127.0.0.1:1';
    process.env.MC_DESKTOP_CONTROL_TOKEN = 'ctl';
    let seen: string | null = null;
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
      seen = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ servers: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await servers();
    expect(seen).toBe('Bearer ctl');
  });

  it('falls back to the on-disk fleet when main is unreachable', async () => {
    process.env.MC_DESKTOP_CONTROL_URL = 'http://127.0.0.1:1';
    process.env.MC_DESKTOP_CONTROL_TOKEN = 'ctl';
    globalThis.fetch = (async () => { throw new Error('refused'); }) as unknown as typeof fetch;
    const list = await servers();
    // The tokenless remote is dropped rather than advertised with the local token.
    expect(list.map((s) => s.id)).toEqual(['self']);
  });
});
