import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ServerSupervisor } from '../server-supervisor';

function fakeChild(pid = 12345) {
  const child: any = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

const okFetch = (async () => ({ ok: true })) as unknown as typeof fetch;
const failFetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

const baseOpts = {
  repoRoot: '/repo',
  project: '/repo',
  session: 's',
  host: '127.0.0.1',
};

describe('ServerSupervisor', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('start() resolves with a free port and attached=false when health passes', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, spawnImpl, fetchImpl: okFetch });
    const { port, attached } = await sup.start();
    expect(port).toBeGreaterThan(0);
    expect(attached).toBe(false);
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [cmd, args] = spawnImpl.mock.calls[0];
    expect(cmd).toBe('bun');
    expect(args).toEqual(['run', 'src/server.ts']);
  });

  it('start() uses the provided port', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    const { port } = await sup.start();
    expect(port).toBe(9999);
  });

  it('start() passes CDP_PORT + electron-view env when cdpPort is set', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, cdpPort: 7777, spawnImpl, fetchImpl: okFetch });
    await sup.start();
    const opts = spawnImpl.mock.calls[0][2] as any;
    expect(opts.env.CDP_PORT).toBe('7777');
    expect(opts.env.MC_BROWSER_TARGET).toBe('electron-view');
    expect(opts.env.PORT).toBe('9999');
    expect(opts.env.MERMAID_BIND_HOST).toBe('127.0.0.1');
  });

  it('start() rejects with health timeout and kills the child', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const sup = new ServerSupervisor({
      ...baseOpts, port: 9999, spawnImpl, fetchImpl: failFetch,
      healthTimeoutMs: 40, healthPollMs: 5,
    });
    await expect(sup.start()).rejects.toThrow('did not respond');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stop() sends SIGTERM for a spawned server', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    await sup.start();
    await sup.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('isHealthy() reflects the fetch result', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch });
    await sup.start();
    expect(await sup.isHealthy()).toBe(true);
  });

  it('isHealthy() returns false before start()', async () => {
    const sup = new ServerSupervisor({ ...baseOpts, fetchImpl: okFetch });
    expect(await sup.isHealthy()).toBe(false);
  });

  it('start() attaches to a healthy existing instance instead of spawning', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const discoveryImpl = vi.fn(async () => [{ project: '/repo', session: 's', port: 5555 }]);
    const sup = new ServerSupervisor({ ...baseOpts, spawnImpl, fetchImpl: okFetch, discoveryImpl });
    const { port, attached } = await sup.start();
    expect(port).toBe(5555);
    expect(attached).toBe(true);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('start() spawns when the discovered instance is for a different session', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const discoveryImpl = vi.fn(async () => [{ project: '/repo', session: 'other', port: 5555 }]);
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl: okFetch, discoveryImpl });
    const { port, attached } = await sup.start();
    expect(port).toBe(9999);
    expect(attached).toBe(false);
    expect(spawnImpl).toHaveBeenCalledOnce();
  });

  it('start() spawns when the discovered instance fails its health check', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const discoveryImpl = vi.fn(async () => [{ project: '/repo', session: 's', port: 5555 }]);
    // first fetch (dedup health) fails, subsequent (spawn health) ok
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) throw new Error('dead');
      return { ok: true };
    }) as unknown as typeof fetch;
    const sup = new ServerSupervisor({ ...baseOpts, port: 9999, spawnImpl, fetchImpl, discoveryImpl });
    const { attached } = await sup.start();
    expect(attached).toBe(false);
    expect(spawnImpl).toHaveBeenCalledOnce();
  });

  it('stop() is a no-op when attached to an existing instance', async () => {
    const spawnImpl = vi.fn(() => fakeChild());
    const discoveryImpl = vi.fn(async () => [{ project: '/repo', session: 's', port: 5555 }]);
    const sup = new ServerSupervisor({ ...baseOpts, spawnImpl, fetchImpl: okFetch, discoveryImpl });
    await sup.start();
    await sup.stop(); // should not throw and nothing to kill
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
