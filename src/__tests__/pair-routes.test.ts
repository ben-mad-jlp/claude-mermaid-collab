import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { handlePairRoutes } from '../routes/pair-routes.js';
import {
  _resetConfigCache,
  getAuthToken,
  migrateEnvAuthToken,
} from '../services/config-file.js';

// Each case gets a throwaway config.json so pairing's auto-provision / rotate
// writes don't touch the real ~/.mermaid-collab/config.json.
const PRIOR_CONFIG_PATH = process.env.MERMAID_CONFIG_PATH;
const PRIOR_TOKEN_ENV = process.env.MERMAID_AUTH_TOKEN;
let cfgPath = '';
let n = 0;

const get = (p: string, peer?: string) =>
  handlePairRoutes(new Request(`http://x${p}`), new URL(`http://x${p}`), peer);
const post = (p: string, peer?: string) =>
  handlePairRoutes(new Request(`http://x${p}`, { method: 'POST' }), new URL(`http://x${p}`), peer);
// Response.json() is typed `unknown`; pairing payloads are dynamic — read as any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response | null): Promise<any> => res!.json();

beforeEach(() => {
  cfgPath = join(tmpdir(), `mc-pair-test-${process.pid}-${n++}.json`);
  if (existsSync(cfgPath)) rmSync(cfgPath);
  process.env.MERMAID_CONFIG_PATH = cfgPath;
  delete process.env.MERMAID_AUTH_TOKEN;
  _resetConfigCache();
});

afterEach(() => {
  if (existsSync(cfgPath)) rmSync(cfgPath);
  if (PRIOR_CONFIG_PATH === undefined) delete process.env.MERMAID_CONFIG_PATH;
  else process.env.MERMAID_CONFIG_PATH = PRIOR_CONFIG_PATH;
  if (PRIOR_TOKEN_ENV === undefined) delete process.env.MERMAID_AUTH_TOKEN;
  else process.env.MERMAID_AUTH_TOKEN = PRIOR_TOKEN_ENV;
  _resetConfigCache();
});

describe('handlePairRoutes — loopback-only guard', () => {
  it('403s GET /api/pair from a non-loopback peer AND does not provision a token', async () => {
    const res = get('/api/pair', '100.88.1.2');
    expect(res?.status).toBe(403);
    // The bootstrap hole: a remote peer must not be able to trigger token creation.
    expect(getAuthToken()).toBe('');
  });

  it('403s POST /api/pair/rotate from a non-loopback peer', () => {
    expect(post('/api/pair/rotate', '100.88.1.2')?.status).toBe(403);
  });

  it('403s when the peer is unresolved (fail-safe — treated as remote)', () => {
    expect(get('/api/pair', undefined)?.status).toBe(403);
  });
});

describe('handlePairRoutes — GET /api/pair from loopback', () => {
  it('auto-provisions a token, persists it, and returns it', async () => {
    const res = get('/api/pair', '127.0.0.1');
    expect(res?.status).toBe(200);
    const b = await readJson(res);
    expect(typeof b.token).toBe('string');
    expect(b.token.length).toBeGreaterThan(0);
    expect(b.bound).toBeTruthy();
    expect(Array.isArray(b.hosts)).toBe(true);
    // Persisted: the live resolver sees the same token without a relaunch.
    expect(getAuthToken()).toBe(b.token);
  });

  it('returns the SAME token on a second call (idempotent provision)', async () => {
    const a = await readJson(get('/api/pair', '::1'));
    const b = await readJson(get('/api/pair', '::1'));
    expect(a.token).toBe(b.token);
  });

  it('emits a QR deep link when a reachable host exists', async () => {
    const b = await readJson(get('/api/pair', '127.0.0.1'));
    if (b.hosts.length > 0) {
      expect(b.qr).toMatch(/^mermaidcollab:\/\/pair\?host=.+&token=/);
    } else {
      expect(b.qr).toBeNull();
    }
  });
});

describe('handlePairRoutes — rotate', () => {
  it('rotate from loopback changes the token', async () => {
    const before = await readJson(get('/api/pair', '127.0.0.1'));
    const after = await readJson(post('/api/pair/rotate', '127.0.0.1'));
    expect(after.token).not.toBe(before.token);
    expect(getAuthToken()).toBe(after.token);
  });
});

describe('handlePairRoutes — /api/auth/check', () => {
  it('200s {ok:true} (gating is checkAuth\'s job, not this handler\'s)', async () => {
    const res = get('/api/auth/check', '100.88.1.2'); // reaching here means checkAuth passed
    expect(res?.status).toBe(200);
    expect((await readJson(res)).ok).toBe(true);
  });

  it('returns null for an unrelated path (falls through)', () => {
    expect(get('/api/something-else', '127.0.0.1')).toBeNull();
  });
});

describe('migrateEnvAuthToken', () => {
  it('migrates an env token into config when config has none', () => {
    process.env.MERMAID_AUTH_TOKEN = 'env-tok';
    _resetConfigCache();
    expect(migrateEnvAuthToken()).toBe('migrated');
    expect(getAuthToken()).toBe('env-tok');
  });

  it('reports diverged when config differs from env (config stays authoritative)', async () => {
    // Provision a config token via pairing, then set a DIFFERENT env token.
    const b = await readJson(get('/api/pair', '127.0.0.1'));
    process.env.MERMAID_AUTH_TOKEN = 'a-different-env-token';
    _resetConfigCache();
    expect(migrateEnvAuthToken()).toBe('diverged');
    expect(getAuthToken()).toBe(b.token); // config wins
  });

  it('noop when no env token is set', () => {
    expect(migrateEnvAuthToken()).toBe('noop');
  });
});
