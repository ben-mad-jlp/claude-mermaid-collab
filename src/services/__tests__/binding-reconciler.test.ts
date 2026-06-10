import { describe, it, expect } from 'bun:test';
import { tickOnce, type BindingReconcilerDeps } from '../binding-reconciler';

const UUID_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const UUID_B = 'a1b2c3d4-e5f6-4789-aabb-ccddeeff0011';

interface Recorded {
  pidRegs: Array<{ pid: number; session: string }>;
  posts: Array<{ project: string; session: string; claudeSessionId: string }>;
  lanes: Array<{ project: string; session: string; tmux: string }>;
}

function makeDeps(opts: {
  bindingFiles?: ReturnType<BindingReconcilerDeps['readBindingFiles']>;
  alivePids?: number[];
  supervised?: Array<{ project: string; session: string; launchProject?: string | null }>;
  liveTmux?: string[];
  laneRegisters?: boolean;
  postOk?: boolean;
}): { deps: BindingReconcilerDeps; rec: Recorded } {
  const rec: Recorded = { pidRegs: [], posts: [], lanes: [] };
  const alive = new Set(opts.alivePids ?? []);
  const liveTmux = new Set(opts.liveTmux ?? []);
  const deps: BindingReconcilerDeps = {
    readBindingFiles: () => opts.bindingFiles ?? [],
    pidAlive: (pid) => alive.has(pid),
    registerPid: (pid, session) => rec.pidRegs.push({ pid, session }),
    postRegister: async (project, session, claudeSessionId) => {
      const ok = opts.postOk ?? true;
      if (ok) rec.posts.push({ project, session, claudeSessionId });
      return ok;
    },
    listSupervised: () => opts.supervised ?? [],
    tmuxName: (project, session) => `mc-${project.split('/').pop()}-${session}`,
    hasTmuxSession: (tmux) => liveTmux.has(tmux),
    registerLane: async (o) => {
      rec.lanes.push(o);
      return { registered: opts.laneRegisters ?? true };
    },
  };
  return { deps, rec };
}

describe('binding-reconciler tickOnce', () => {
  it('PASS A: rehydrates a live binding file (re-asserts in-memory map + posts)', async () => {
    const { deps, rec } = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'frontend-1', claudePid: 1234 }],
      alivePids: [1234],
    });
    const r = await tickOnce(deps);
    expect(r.rehydrated).toBe(1);
    expect(rec.pidRegs).toEqual([{ pid: 1234, session: 'frontend-1' }]);
    expect(rec.posts).toEqual([{ project: '/p/app', session: 'frontend-1', claudeSessionId: UUID_A }]);
  });

  it('PASS A: skips a dead-PID binding file (leaves it for the sweeper, never posts)', async () => {
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

  it('PASS B: derives a worker lane from the supervised registry ∩ live tmux', async () => {
    const { deps, rec } = makeDeps({
      bindingFiles: [],
      supervised: [{ project: '/p/app', session: 'backend-2' }],
      liveTmux: ['mc-app-backend-2'],
    });
    const r = await tickOnce(deps);
    expect(r.derived).toBe(1);
    expect(rec.lanes).toEqual([{ project: '/p/app', session: 'backend-2', tmux: 'mc-app-backend-2' }]);
  });

  it('PASS B: skips a supervised lane whose tmux is gone', async () => {
    const { deps, rec } = makeDeps({
      supervised: [{ project: '/p/app', session: 'backend-2' }],
      liveTmux: [], // pane gone
    });
    const r = await tickOnce(deps);
    expect(r.derived).toBe(0);
    expect(rec.lanes).toEqual([]);
  });

  it('PASS B: uses launchProject for the tmux name on a cross-project lane', async () => {
    const { deps, rec } = makeDeps({
      supervised: [{ project: '/track/repo', session: 'backend-1', launchProject: '/target/other' }],
      liveTmux: ['mc-other-backend-1'],
    });
    await tickOnce(deps);
    expect(rec.lanes).toEqual([{ project: '/track/repo', session: 'backend-1', tmux: 'mc-other-backend-1' }]);
  });

  it('does not double-register a lane already rehydrated in pass A', async () => {
    const { deps, rec } = makeDeps({
      bindingFiles: [{ claudeSessionId: UUID_A, project: '/p/app', session: 'backend-2', claudePid: 1234 }],
      alivePids: [1234],
      supervised: [{ project: '/p/app', session: 'backend-2' }],
      liveTmux: ['mc-app-backend-2'],
    });
    const r = await tickOnce(deps);
    expect(r.rehydrated).toBe(1);
    expect(r.derived).toBe(0); // pass B sees it in `seen` and skips
    expect(rec.lanes).toEqual([]);
  });});
