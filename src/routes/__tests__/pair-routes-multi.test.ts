import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePairRoutes } from '../pair-routes.ts';

/**
 * The pairing payload consults the Electron control channel when MC_DESKTOP_CONTROL_URL
 * and MC_DESKTOP_CONTROL_TOKEN are present. The land gate runs as a CHILD OF THE SIDECAR,
 * which has both set, so these tests reached the LIVE desktop and saw the operator's real
 * fleet instead of the stub written below — passing in a bare shell and failing only in
 * the gate (2026-08-21). Clear them for every test so the on-disk stub is authoritative.
 */
beforeEach(() => {
  delete process.env.MC_DESKTOP_CONTROL_URL;
  delete process.env.MC_DESKTOP_CONTROL_TOKEN;
});

const NO_CONTROL_FLEET = { controlFleet: async () => null };

describe('pair-routes v2 payload', () => {
  let dir: string;
  let configPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pair-routes-multi-'));
    configPath = join(dir, 'config.json');
    process.env.MERMAID_CONFIG_PATH = configPath;
  });

  afterAll(() => {
    delete process.env.MERMAID_CONFIG_PATH;
    delete process.env.MERMAID_DESKTOP_SERVERS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('(1) payload carries a version field equal to 2', async () => {
    const res = await handlePairRoutes(
      new Request('http://x/api/pair'),
      new URL('http://x/api/pair'),
      '127.0.0.1',
      NO_CONTROL_FLEET
    );
    const body = (await res!.json()) as any;
    expect(body.version).toBe(2);
  });

  it('(2) servers array length equals the number of configured servers', async () => {
    const serversFile = join(dir, 'servers.json');
    writeFileSync(
      serversFile,
      JSON.stringify({
        entries: [
          { id: 'srv-1', label: 'Studio', host: '100.64.1.1', port: 9002, token: 'tok-1' },
          { id: 'srv-2', label: 'Laptop', host: '100.64.1.2', port: 9002, token: 'tok-2' },
        ],
        forgotten: [],
      })
    );
    process.env.MERMAID_DESKTOP_SERVERS_FILE = serversFile;

    const res = await handlePairRoutes(
      new Request('http://x/api/pair'),
      new URL('http://x/api/pair'),
      '127.0.0.1',
      NO_CONTROL_FLEET
    );
    const body = (await res!.json()) as any;
    expect(body.servers.length).toBe(2);
  });

  it('(3) each servers element carries the keys label, host and token', async () => {
    const serversFile = join(dir, 'servers.json');
    writeFileSync(
      serversFile,
      JSON.stringify({
        entries: [
          { id: 'srv-1', label: 'Studio', host: '100.64.1.1', port: 9002, token: 'tok-1' },
          { id: 'srv-2', label: 'Laptop', host: '100.64.1.2', port: 9002, token: 'tok-2' },
        ],
        forgotten: [],
      })
    );
    process.env.MERMAID_DESKTOP_SERVERS_FILE = serversFile;

    const res = await handlePairRoutes(
      new Request('http://x/api/pair'),
      new URL('http://x/api/pair'),
      '127.0.0.1',
      NO_CONTROL_FLEET
    );
    const body = (await res!.json()) as any;
    for (const s of body.servers) {
      for (const key of ['label', 'host', 'token']) {
        expect(Object.prototype.hasOwnProperty.call(s, key)).toBe(true);
        expect(typeof s[key]).toBe('string');
        expect(s[key].length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * A pairing payload is consumed on ANOTHER device. A loopback host inside it points at
 * that device, not at this Mac — the phone scanned the QR and still could not reach the
 * server (2026-08-21). The local fleet entry must be rewritten to a routable address.
 */
describe('pair-routes self-host rewrite', () => {
  let dir2: string;

  beforeAll(() => {
    dir2 = mkdtempSync(join(tmpdir(), 'pair-routes-selfhost-'));
    process.env.MERMAID_CONFIG_PATH = join(dir2, 'config.json');
  });

  afterAll(() => {
    delete process.env.MERMAID_CONFIG_PATH;
    delete process.env.MERMAID_DESKTOP_SERVERS_FILE;
    rmSync(dir2, { recursive: true, force: true });
  });

  async function serversFor(entries: unknown[]): Promise<any[]> {
    const f = join(dir2, 'servers.json');
    writeFileSync(f, JSON.stringify({ entries, forgotten: [] }));
    process.env.MERMAID_DESKTOP_SERVERS_FILE = f;
    const res = await handlePairRoutes(
      new Request('http://x/api/pair'),
      new URL('http://x/api/pair'),
      '127.0.0.1',
      NO_CONTROL_FLEET
    );
    return ((await res!.json()) as any).servers;
  }

  it('(1) a loopback fleet entry is rewritten to a non-loopback host', async () => {
    const servers = await serversFor([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
    ]);
    expect(servers).toHaveLength(1);
    expect(servers[0].host.startsWith('127.0.0.1:')).toBe(false);
    expect(servers[0].host.endsWith(':9002')).toBe(true);
  });

  it('(2) a localhost fleet entry is rewritten the same way', async () => {
    const servers = await serversFor([
      { id: 'self', label: 'This Mac', host: 'localhost', port: 9002, token: 'tok-self' },
    ]);
    expect(servers[0].host.startsWith('localhost:')).toBe(false);
  });

  it('(3) a remote fleet entry keeps its own host untouched', async () => {
    const servers = await serversFor([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
      { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002, token: 'tok-rem' },
    ]);
    const remote = servers.find((s: any) => s.id === 'rem');
    expect(remote.host).toBe('trimaxion.tail445728.ts.net:9002');
  });
});

/**
 * iOS ATS exempts cleartext by DOMAIN, never by raw address, and Tailscale's CGNAT
 * range is not covered by NSAllowsLocalNetworking — so a payload carrying 100.x.x.x is
 * refused by the phone before the request leaves it (2026-08-21). Advertise the
 * MagicDNS NAME for the local entry whenever we know it.
 */
describe('pair-routes MagicDNS preference', () => {
  let dir3: string;

  beforeAll(() => {
    dir3 = mkdtempSync(join(tmpdir(), 'pair-routes-magicdns-'));
    process.env.MERMAID_CONFIG_PATH = join(dir3, 'config.json');
  });

  afterAll(() => {
    delete process.env.MERMAID_CONFIG_PATH;
    delete process.env.MERMAID_TAILNET_HOST;
    delete process.env.MERMAID_DESKTOP_SERVERS_FILE;
    rmSync(dir3, { recursive: true, force: true });
  });

  async function serversWith(entries: unknown[]): Promise<any[]> {
    const f = join(dir3, 'servers.json');
    writeFileSync(f, JSON.stringify({ entries, forgotten: [] }));
    process.env.MERMAID_DESKTOP_SERVERS_FILE = f;
    const res = await handlePairRoutes(
      new Request('http://x/api/pair'),
      new URL('http://x/api/pair'),
      '127.0.0.1',
      NO_CONTROL_FLEET
    );
    return ((await res!.json()) as any).servers;
  }

  it('(1) the local entry advertises the MagicDNS name, not the tailnet IP', async () => {
    process.env.MERMAID_TAILNET_HOST = 'bens-macbook-pro.tail445728.ts.net';
    const servers = await serversWith([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 't' },
    ]);
    expect(servers[0].host).toBe('bens-macbook-pro.tail445728.ts.net:9002');
  });

  it('(2) the advertised host ends in a ts.net domain so the ATS exception applies', async () => {
    process.env.MERMAID_TAILNET_HOST = 'bens-macbook-pro.tail445728.ts.net';
    const servers = await serversWith([
      { id: 'self', label: 'This Mac', host: 'localhost', port: 9002, token: 't' },
    ]);
    expect(servers[0].host.split(':')[0].endsWith('.ts.net')).toBe(true);
  });

  it('(3) with no MagicDNS name available the local entry still gets a non-loopback host', async () => {
    delete process.env.MERMAID_TAILNET_HOST;
    const servers = await serversWith([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 't' },
    ]);
    expect(servers[0].host.startsWith('127.0.0.1:')).toBe(false);
  });
});

/**
 * A remote fleet entry with no token of its own must be OMITTED, never handed this
 * server's token. The desktop advertised trimaxion with the Mac's credential; the phone
 * called trimaxion, got a 401, and unpaired itself in a loop while the Mac — which it was
 * correctly paired to — logged nothing at all (2026-08-21).
 */
describe('pair-routes token honesty', () => {
  let dir4: string;

  beforeAll(() => {
    dir4 = mkdtempSync(join(tmpdir(), 'pair-routes-token-'));
    process.env.MERMAID_CONFIG_PATH = join(dir4, 'config.json');
    process.env.MERMAID_TAILNET_HOST = 'self.tail445728.ts.net';
  });

  afterAll(() => {
    delete process.env.MERMAID_CONFIG_PATH;
    delete process.env.MERMAID_TAILNET_HOST;
    delete process.env.MERMAID_DESKTOP_SERVERS_FILE;
    rmSync(dir4, { recursive: true, force: true });
  });

  async function payloadFor(entries: unknown[]): Promise<any> {
    const f = join(dir4, 'servers.json');
    writeFileSync(f, JSON.stringify({ entries, forgotten: [] }));
    process.env.MERMAID_DESKTOP_SERVERS_FILE = f;
    const res = await handlePairRoutes(
      new Request('http://x/api/pair'),
      new URL('http://x/api/pair'),
      '127.0.0.1',
      NO_CONTROL_FLEET
    );
    return await res!.json();
  }

  it('(1) a remote entry with no token is omitted from the payload', async () => {
    const body = await payloadFor([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
      { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002 },
    ]);
    expect(body.servers.map((s: any) => s.id)).toEqual(['self']);
  });

  it('(2) a remote entry WITH its own token is kept, carrying that token', async () => {
    const body = await payloadFor([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
      { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002, token: 'tok-rem' },
    ]);
    const remote = body.servers.find((s: any) => s.id === 'rem');
    expect(remote.token).toBe('tok-rem');
  });

  it('(3) no advertised server carries a token belonging to a different server', async () => {
    const body = await payloadFor([
      { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
      { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002 },
    ]);
    const remote = body.servers.find((s: any) => s.id === 'rem');
    expect(remote).toBeUndefined();
  });
});

/**
 * ONE server per QR (operator decision 2026-08-21). Bundling the whole fleet into one
 * code made the payload large and dense enough to be hard to scan, and let one peer's
 * bad credential poison the pairing. `?serverId=` narrows the payload to that server.
 */
describe('pair-routes single-server payload', () => {
  let dir5: string;

  beforeAll(() => {
    dir5 = mkdtempSync(join(tmpdir(), 'pair-routes-single-'));
    process.env.MERMAID_CONFIG_PATH = join(dir5, 'config.json');
    process.env.MERMAID_TAILNET_HOST = 'self.tail445728.ts.net';
    const f = join(dir5, 'servers.json');
    writeFileSync(f, JSON.stringify({
      entries: [
        { id: 'self', label: 'This Mac', host: '127.0.0.1', port: 9002, token: 'tok-self' },
        { id: 'rem', label: 'trimaxion', host: 'trimaxion.tail445728.ts.net', port: 9002, token: 'tok-rem' },
      ],
      forgotten: [],
    }));
    process.env.MERMAID_DESKTOP_SERVERS_FILE = f;
  });

  afterAll(() => {
    delete process.env.MERMAID_CONFIG_PATH;
    delete process.env.MERMAID_TAILNET_HOST;
    delete process.env.MERMAID_DESKTOP_SERVERS_FILE;
    rmSync(dir5, { recursive: true, force: true });
  });

  async function body(query: string): Promise<any> {
    const u = new URL(`http://x/api/pair${query}`);
    const res = await handlePairRoutes(new Request(u.toString()), u, '127.0.0.1');
    return await res!.json();
  }

  it('(1) serverId narrows the payload to that one server', async () => {
    const b = await body('?serverId=rem');
    expect(b.servers.map((s: any) => s.id)).toEqual(['rem']);
  });

  it('(2) the narrowed payload carries that server own token', async () => {
    const b = await body('?serverId=rem');
    expect(b.servers[0].token).toBe('tok-rem');
  });

  it('(3) an unknown serverId yields an empty server list rather than the whole fleet', async () => {
    const b = await body('?serverId=nope');
    expect(b.servers).toHaveLength(0);
  });

  it('(4) omitting serverId still returns every server', async () => {
    const b = await body('');
    expect(b.servers.map((s: any) => s.id).sort()).toEqual(['rem', 'self']);
  });
});
