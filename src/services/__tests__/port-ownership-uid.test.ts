// uid-aware handshake tests: foreign-uid refusal, EPERM-vs-ESRCH evict handling,
// and back-compat with uid-absent legacy holders. All injected deps — no real
// FS, sockets, or processes.
import { describe, test, expect } from 'bun:test';
import { performHandshake, type HandshakeDeps } from '../port-ownership';

// The uid-refuse gate in performHandshake compares holder.uid against the REAL
// process.getuid() (not an injected value), so tests must use the actual uid.
const SELF_UID = typeof process.getuid === 'function' ? process.getuid() : 0;
const OTHER_UID = SELF_UID + 1;

const SELF = { exePath: '/opt/mermaid-collab/bin/server', version: '5.92.0', owner: 'dev', uid: SELF_UID };

function healthResponse(body: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function baseDeps(overrides: Partial<HandshakeDeps> = {}): HandshakeDeps {
  return {
    host: '127.0.0.1',
    env: {},
    self: SELF,
    portInUseImpl: async () => true, // port is held
    killImpl: () => {},
    ...overrides,
  };
}

describe('performHandshake — uid-aware identity', () => {
  test('foreign-uid healthy holder → refuse', async () => {
    const fetchImpl = (async () =>
      healthResponse({
        pid: 999999,
        version: '5.92.0',
        exePath: '/other/exe',
        startedAt: '2026-07-17T00:00:00.000Z',
        owner: 'dev',
        uid: OTHER_UID,
      })) as unknown as typeof fetch;

    const result = await performHandshake(baseDeps({ fetchImpl }));
    expect(result.action).toBe('refuse');
    expect(result.reason).toContain('foreign-uid');
  });

  test('foreign-uid holder with same exePath and newer version → refuse, not defer', async () => {
    const fetchImpl = (async () =>
      healthResponse({
        pid: 999999,
        version: '9.0.0',
        exePath: SELF.exePath,
        startedAt: '2026-07-17T00:00:00.000Z',
        owner: 'dev',
        uid: OTHER_UID,
      })) as unknown as typeof fetch;

    const result = await performHandshake(baseDeps({ fetchImpl }));
    expect(result.action).toBe('refuse');
    expect(result.action).not.toBe('defer');
    expect(result.reason).toContain('foreign-uid');
  });

  test('EPERM on kill of a stale/foreign holder → refuse, not proceed', async () => {
    const fetchImpl = (async () =>
      healthResponse({
        pid: 999999,
        version: '1.0.0',
        exePath: '/other/exe',
        startedAt: '2026-07-17T00:00:00.000Z',
        owner: 'dev',
        // uid absent → reaches the takeover branch instead of the uid gate
      })) as unknown as typeof fetch;

    const killImpl = () => {
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    };

    const result = await performHandshake(baseDeps({ fetchImpl, killImpl }));
    expect(result.action).toBe('refuse');
    expect(result.reason).toContain('foreign-process-eperm');
  });

  test('uid-absent legacy holder → back-compat takeover arms unchanged', async () => {
    const fetchImpl = (async () =>
      healthResponse({
        pid: 999999,
        version: '1.0.0',
        exePath: '/other/exe',
        startedAt: '2026-07-17T00:00:00.000Z',
        owner: 'dev',
        // uid absent (legacy holder, predates this field)
      })) as unknown as typeof fetch;

    let killed = false;
    const killImpl = () => {
      killed = true;
    };
    const portInUseImpl = async () => (killed ? false : true);

    const result = await performHandshake(baseDeps({ fetchImpl, killImpl, portInUseImpl }));
    expect(result.action).toBe('proceed');
    expect(result.reason).toBe('took-over-stale-holder');
  });

  test('same-uid rightful owner → defer', async () => {
    const fetchImpl = (async () =>
      healthResponse({
        pid: 999999,
        version: SELF.version,
        exePath: SELF.exePath,
        startedAt: '2026-07-17T00:00:00.000Z',
        owner: 'dev',
        uid: SELF_UID,
      })) as unknown as typeof fetch;

    const result = await performHandshake(baseDeps({ fetchImpl }));
    expect(result.action).toBe('defer');
    expect(result.reason).toBe('rightful-owner-present');
  });

  test('same-uid stale holder → evict cleanly and proceed', async () => {
    const fetchImpl = (async () =>
      healthResponse({
        pid: 999999,
        version: '1.0.0',
        exePath: '/other/exe',
        startedAt: '2026-07-17T00:00:00.000Z',
        owner: 'dev',
        uid: SELF_UID,
      })) as unknown as typeof fetch;

    let killed = false;
    const killImpl = () => {
      killed = true;
    };
    const portInUseImpl = async () => (killed ? false : true);

    const result = await performHandshake(baseDeps({ fetchImpl, killImpl, portInUseImpl }));
    expect(result.action).toBe('proceed');
    expect(result.reason).toBe('took-over-stale-holder');
  });
});
