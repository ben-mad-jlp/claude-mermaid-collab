// resolveOwnPort — per-user coexistence fallback tests. When :9002 is held by
// ANOTHER OS user, resolveOwnPort must fall back to a per-user port instead of
// refusing, so a second user can run their own collab server on one machine.
// All injected deps — no real FS beyond an isolated runtime dir, no sockets.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveOwnPort, deriveUserPort, type HandshakeDeps } from '../port-ownership';

// The uid gate in performHandshake compares holder.uid against the REAL
// process.getuid(), so tests must use the actual uid for `self`.
const SELF_UID = typeof process.getuid === 'function' ? process.getuid() : 0;
const OTHER_UID = SELF_UID + 1;
const SELF = { exePath: '/opt/mermaid-collab/bin/server', version: '5.92.0', owner: 'dev', uid: SELF_UID };
const CANON = 9002;

let runtimeDir: string;
beforeEach(() => { runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-resolve-')); });
afterEach(() => { fs.rmSync(runtimeDir, { recursive: true, force: true }); });

function healthResponse(body: Record<string, unknown>) {
  return { ok: true, json: async () => body } as Response;
}

/** A holder on the queried port owned by ANOTHER uid (triggers foreign-uid refuse). */
const foreignHolder = (async () =>
  healthResponse({ pid: 999999, version: '5.92.0', exePath: '/other/exe', startedAt: 'x', owner: 'dev', uid: OTHER_UID })
) as unknown as typeof fetch;

function deps(overrides: Partial<HandshakeDeps> & { allowFallback?: boolean } = {}) {
  return {
    host: '127.0.0.1',
    env: { XDG_RUNTIME_DIR: runtimeDir },
    self: SELF,
    killImpl: () => {},
    port: CANON,
    ...overrides,
  };
}

describe('deriveUserPort', () => {
  test('stable, above base, keyed by uid', () => {
    expect(deriveUserPort(9002, 1000)).toBe(9002 + 1 + (1000 % 400));
    expect(deriveUserPort(9002, 1000)).toBe(deriveUserPort(9002, 1000));
    expect(deriveUserPort(9002, 1000)).not.toBe(deriveUserPort(9002, 1001));
    expect(deriveUserPort(9002, null)).toBe(9003);
  });
});

describe('resolveOwnPort — per-user coexistence', () => {
  test('canonical port free → proceed on canonical, no fallback', async () => {
    const r = await resolveOwnPort(deps({ portInUseImpl: async () => false }));
    expect(r.action).toBe('proceed');
    expect(r.port).toBe(CANON);
  });

  test('another user holds :9002 → falls back to this user\'s port', async () => {
    const fallback = deriveUserPort(CANON, SELF_UID);
    const portInUseImpl = async (p: number) => p === CANON; // only canonical held
    const r = await resolveOwnPort(deps({ portInUseImpl, fetchImpl: foreignHolder }));
    expect(r.action).toBe('proceed');
    expect(r.port).toBe(fallback);
    expect(r.reason).toContain('coexist-fallback');
  });

  test('allowFallback:false keeps strict refuse on a foreign holder', async () => {
    const portInUseImpl = async (p: number) => p === CANON;
    const r = await resolveOwnPort(deps({ portInUseImpl, fetchImpl: foreignHolder, allowFallback: false }));
    expect(r.action).toBe('refuse');
    expect(r.port).toBe(CANON);
  });

  test('our own server already on the fallback port → defer to it', async () => {
    const fallback = deriveUserPort(CANON, SELF_UID);
    const portInUseImpl = async (p: number) => p === CANON || p === fallback;
    const fetchImpl = (async (url: string) => {
      const isCanon = String(url).includes(`:${CANON}/`);
      return healthResponse(isCanon
        ? { pid: 1, version: '5.92.0', exePath: '/other/exe', owner: 'dev', uid: OTHER_UID }
        : { pid: 2, version: SELF.version, exePath: SELF.exePath, owner: 'dev', uid: SELF_UID });
    }) as unknown as typeof fetch;
    const r = await resolveOwnPort(deps({ portInUseImpl, fetchImpl }));
    expect(r.action).toBe('defer');
    expect(r.port).toBe(fallback);
  });
});
