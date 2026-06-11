// Pure classifyInstances + injected-deps instanceTopology tests — no real FS,
// sockets, or processes.
import { describe, test, expect } from 'bun:test';
import type { Instance } from '../instance-discovery';
import {
  classifyInstances,
  instanceTopology,
  CANONICAL_PORT,
} from '../instance-topology';

function inst(partial: Partial<Instance> & { sessionId: string; port: number; pid: number }): Instance {
  return {
    version: 1,
    project: '/p',
    session: 's',
    startedAt: '2026-06-11T00:00:00.000Z',
    serverVersion: '5.92.0',
    ...partial,
  };
}

const ALL_ALIVE = () => true;

describe('classifyInstances', () => {
  test('tags the live :9002 owner canonical and the other contender shadow', () => {
    const canonical = inst({ sessionId: 'aaa', port: CANONICAL_PORT, pid: 100 });
    const shadow = inst({ sessionId: 'bbb', port: CANONICAL_PORT, pid: 200, session: 'plugin' });
    const tagged = classifyInstances([canonical, shadow], CANONICAL_PORT, 100, ALL_ALIVE);

    expect(tagged.find((t) => t.pid === 100)!.tag).toBe('canonical');
    expect(tagged.find((t) => t.pid === 200)!.tag).toBe('shadow');
  });

  test('a server on its own non-canonical port is a plain instance', () => {
    const other = inst({ sessionId: 'ccc', port: 9105, pid: 300 });
    const [tagged] = classifyInstances([other], CANONICAL_PORT, 100, ALL_ALIVE);
    expect(tagged.tag).toBe('instance');
    expect(tagged.reason).toContain('9105');
  });

  test('one live :9002 server with no known owner is canonical by elimination', () => {
    const only = inst({ sessionId: 'ddd', port: CANONICAL_PORT, pid: 400 });
    const [tagged] = classifyInstances([only], CANONICAL_PORT, null, ALL_ALIVE);
    expect(tagged.tag).toBe('canonical');
  });

  test('two :9002 contenders with no known owner are BOTH flagged shadow (no false all-clear)', () => {
    const a = inst({ sessionId: 'eee', port: CANONICAL_PORT, pid: 500 });
    const b = inst({ sessionId: 'fff', port: CANONICAL_PORT, pid: 600 });
    const tagged = classifyInstances([a, b], CANONICAL_PORT, null, ALL_ALIVE);
    expect(tagged.every((t) => t.tag === 'shadow')).toBe(true);
  });

  test('reports liveness from the pidAlive probe', () => {
    const dead = inst({ sessionId: 'ggg', port: 9105, pid: 700 });
    const [tagged] = classifyInstances([dead], CANONICAL_PORT, 100, () => false);
    expect(tagged.alive).toBe(false);
  });
});

describe('instanceTopology (injected deps)', () => {
  const baseDeps = { pidAlive: ALL_ALIVE };

  test('uses the live /api/health pid as the canonical owner and flags a shadow', async () => {
    const canonical = inst({ sessionId: 'aaa', port: CANONICAL_PORT, pid: 100 });
    const shadow = inst({ sessionId: 'bbb', port: CANONICAL_PORT, pid: 200, session: 'plugin-hook' });

    const topo = await instanceTopology({
      ...baseDeps,
      readInstancesImpl: async () => [canonical, shadow],
      readHealth: async () => ({
        ok: true,
        version: '5.92.0',
        pid: 100,
        exePath: '/Applications/Mermaid Collab.app/Contents/Resources/mc-server',
        startedAt: '2026-06-11T00:00:00.000Z',
        owner: 'desktop',
      }),
      readLockImpl: () => ({ pid: 100, exePath: '/app', version: '5.92.0', port: CANONICAL_PORT, owner: 'desktop' }),
      listPeersImpl: () => [{ serverId: 'peer-1', baseUrl: 'https://peer.example', token: 't' }],
    });

    expect(topo.canonicalHolder?.pid).toBe(100);
    expect(topo.hasShadow).toBe(true);
    expect(topo.instances.find((i) => i.pid === 100)!.tag).toBe('canonical');
    expect(topo.instances.find((i) => i.pid === 200)!.tag).toBe('shadow');
    expect(topo.peers).toEqual([{ serverId: 'peer-1', baseUrl: 'https://peer.example', authed: true }]);
  });

  test('falls back to a live lockfile owner when /api/health does not answer', async () => {
    const canonical = inst({ sessionId: 'aaa', port: CANONICAL_PORT, pid: 100 });
    const shadow = inst({ sessionId: 'bbb', port: CANONICAL_PORT, pid: 200 });

    const topo = await instanceTopology({
      ...baseDeps,
      readInstancesImpl: async () => [canonical, shadow],
      readHealth: async () => null,
      readLockImpl: () => ({ pid: 100, exePath: '/app', version: '5.92.0', port: CANONICAL_PORT, owner: 'desktop' }),
      listPeersImpl: () => [],
    });

    expect(topo.canonicalHolder).toBeNull();
    expect(topo.instances.find((i) => i.pid === 100)!.tag).toBe('canonical');
    expect(topo.instances.find((i) => i.pid === 200)!.tag).toBe('shadow');
  });

  test('no shadow when only the canonical server is registered', async () => {
    const topo = await instanceTopology({
      ...baseDeps,
      readInstancesImpl: async () => [inst({ sessionId: 'aaa', port: CANONICAL_PORT, pid: 100 })],
      readHealth: async () => null,
      readLockImpl: () => null,
      listPeersImpl: () => [],
    });
    expect(topo.hasShadow).toBe(false);
    expect(topo.instances[0].tag).toBe('canonical');
  });
});
