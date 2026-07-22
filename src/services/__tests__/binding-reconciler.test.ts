import { describe, it, expect } from 'bun:test';
import { tickOnce, type BindingReconcilerDeps } from '../binding-reconciler';

const UUID_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

interface Recorded {
  pidRegs: Array<{ pid: number; session: string }>;
  posts: Array<{ project: string; session: string; claudeSessionId: string }>;
}

function makeDeps(opts: {
  bindingFiles?: ReturnType<BindingReconcilerDeps['readBindingFiles']>;
  alivePids?: number[];
  postOk?: boolean;
}): { deps: BindingReconcilerDeps; rec: Recorded } {
  const rec: Recorded = { pidRegs: [], posts: [] };
  const alive = new Set(opts.alivePids ?? []);
  const deps: BindingReconcilerDeps = {
    readBindingFiles: () => opts.bindingFiles ?? [],
    pidAlive: (pid) => alive.has(pid),
    registerPid: (pid, session) => rec.pidRegs.push({ pid, session }),
    postRegister: async (project, session, claudeSessionId) => {
      const ok = opts.postOk ?? true;
      if (ok) rec.posts.push({ project, session, claudeSessionId });
      return ok;
    },
  };
  return { deps, rec };
}

describe('binding-reconciler tickOnce', () => {
  it('rehydrates a live binding file (re-asserts in-memory map + posts)', async () => {
    const { deps, rec } = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'frontend-1', claudePid: 1234 }],
      alivePids: [1234],
    });
    const r = await tickOnce(deps);
    expect(r.rehydrated).toBe(1);
    expect(rec.pidRegs).toEqual([{ pid: 1234, session: 'frontend-1' }]);
    expect(rec.posts).toEqual([{ project: '/p/app', session: 'frontend-1', claudeSessionId: UUID_A }]);
  });

  it('skips a dead-PID binding file (leaves it for the sweeper, never posts)', async () => {
    const { deps, rec } = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'frontend-1', claudePid: 1234 }],
      alivePids: [], // 1234 is dead
    });
    const r = await tickOnce(deps);
    expect(r.rehydrated).toBe(0);
    expect(r.deadSkipped).toBe(1);
    expect(rec.posts).toEqual([]);
    expect(rec.pidRegs).toEqual([]);
  });

  it('REGRESSION: a second tick does NOT re-broadcast an already-announced session', async () => {
    const { deps, rec } = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'frontend-1', claudePid: 1234 }],
      alivePids: [1234],
    });
    const announced = new Set<string>(); // persisted across ticks, as the class does
    const r1 = await tickOnce(deps, announced);
    const r2 = await tickOnce(deps, announced);
    expect(r1.rehydrated).toBe(1);
    expect(r2.rehydrated).toBe(0);          // already announced -> no re-broadcast
    expect(rec.posts.length).toBe(1);        // exactly ONE registered broadcast total
    expect(rec.pidRegs.length).toBe(2);      // routing map re-asserted both ticks (silent)
  });

  it('re-announces after the session dies and returns (announced GC)', async () => {
    const announced = new Set<string>();
    const live = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'frontend-1', claudePid: 1234 }],
      alivePids: [1234],
    });
    await tickOnce(live.deps, announced);
    expect(announced.has(UUID_A)).toBe(true);
    const gone = makeDeps({ bindingFiles: [], alivePids: [] });
    await tickOnce(gone.deps, announced);
    expect(announced.has(UUID_A)).toBe(false);
    const back = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'frontend-1', claudePid: 1234 }],
      alivePids: [1234],
    });
    const r = await tickOnce(back.deps, announced);
    expect(r.rehydrated).toBe(1);
    expect(back.rec.posts.length).toBe(1);
  });
});
