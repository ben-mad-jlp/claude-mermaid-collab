import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  registerLeafProc,
  unregisterLeafProc,
  killLeafSubtree,
  killLeafProcsForProject,
  killAllLeafSubtrees,
  listTrackedLeaves,
  groupKillPid,
  markRunLive,
  markRunDone,
  isRunLive,
  _resetLeafProcRegistry,
} from '../leaf-subprocess-registry';

const PROJ = '/p/alpha';
const PROJ2 = '/p/beta';

// Capture process.kill calls (signal, pid) without actually signalling anything.
let killed: Array<{ pid: number; sig: string | number }>;
const realKill = process.kill;

beforeEach(() => {
  _resetLeafProcRegistry();
  killed = [];
  (process as unknown as { kill: typeof process.kill }).kill = ((pid: number, sig?: string | number) => {
    killed.push({ pid, sig: sig ?? 0 });
    return true;
  }) as typeof process.kill;
});
afterEach(() => {
  (process as unknown as { kill: typeof process.kill }).kill = realKill;
});

describe('leaf-subprocess-registry', () => {
  it('registers and lists a tracked leaf; unregister forgets it', () => {
    registerLeafProc('L1', 1234, PROJ);
    expect(listTrackedLeaves()).toEqual([{ leafId: 'L1', pid: 1234, project: PROJ }]);
    unregisterLeafProc('L1', 1234);
    expect(listTrackedLeaves()).toEqual([]);
  });

  it('no-ops without a leafId or pid', () => {
    registerLeafProc(undefined, 1, PROJ);
    registerLeafProc('L', undefined, PROJ);
    expect(listTrackedLeaves()).toEqual([]);
  });

  it('unregister with a STALE pid does not evict the current entry (fast next-node spawn)', () => {
    registerLeafProc('L1', 100, PROJ); // node A
    registerLeafProc('L1', 200, PROJ); // node B overwrote A
    unregisterLeafProc('L1', 100);     // node A's late finally must NOT clear B
    expect(listTrackedLeaves()).toEqual([{ leafId: 'L1', pid: 200, project: PROJ }]);
    unregisterLeafProc('L1', 200);
    expect(listTrackedLeaves()).toEqual([]);
  });

  it('killLeafSubtree group-SIGTERMs the leader pid and forgets it; unknown → false', () => {
    registerLeafProc('L1', 4242, PROJ);
    expect(killLeafSubtree('L1')).toBe(true);
    // negative pid == kill the whole process group (the detached child is the leader).
    expect(killed[0]).toEqual({ pid: -4242, sig: 'SIGTERM' });
    expect(listTrackedLeaves()).toEqual([]);
    expect(killLeafSubtree('L1')).toBe(false); // already gone
  });

  it('killLeafProcsForProject kills only the matching project', () => {
    registerLeafProc('A', 11, PROJ);
    registerLeafProc('B', 22, PROJ2);
    registerLeafProc('C', 33, PROJ);
    const got = killLeafProcsForProject(PROJ).sort();
    expect(got).toEqual(['A', 'C']);
    expect(killed.map((k) => k.pid).sort((a, b) => a - b)).toEqual([-33, -11]);
    expect(listTrackedLeaves()).toEqual([{ leafId: 'B', pid: 22, project: PROJ2 }]);
  });

  it('killAllLeafSubtrees kills every tracked leaf', () => {
    registerLeafProc('A', 11, PROJ);
    registerLeafProc('B', 22, PROJ2);
    expect(killAllLeafSubtrees().sort()).toEqual(['A', 'B']);
    expect(listTrackedLeaves()).toEqual([]);
    expect(killed.length).toBe(2);
  });

  it('groupKillPid(undefined) is a no-op', () => {
    groupKillPid(undefined);
    expect(killed).toEqual([]);
  });

  it('run-level liveness (E4): markRunLive/Done are independent of the per-node pid map', () => {
    expect(isRunLive('R1')).toBe(false);
    markRunLive('R1');
    expect(isRunLive('R1')).toBe(true);
    // a run is live even with NO tracked subprocess (the between-nodes gap).
    expect(listTrackedLeaves()).toEqual([]);
    markRunDone('R1');
    expect(isRunLive('R1')).toBe(false);
  });
});
