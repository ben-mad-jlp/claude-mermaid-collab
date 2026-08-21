import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePairRoutes } from '../pair-routes.ts';

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
      '127.0.0.1'
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
      '127.0.0.1'
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
      '127.0.0.1'
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
