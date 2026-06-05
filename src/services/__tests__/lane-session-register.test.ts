import { describe, it, expect } from 'bun:test';
import {
  resolveLaneClaudeSession,
  registerLaneClaudeSession,
  type LaneRegisterDeps,
} from '../lane-session-register';

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

/** Build deps over a fake process tree + session-id files. `tree` maps a pid to
 *  its direct children; `sessionIds` maps a pid to the UUID its hook wrote. */
function makeDeps(opts: {
  panePid: number | null;
  tree: Record<number, number[]>;
  sessionIds: Record<number, string>;
  overrides?: Partial<LaneRegisterDeps>;
}): { deps: LaneRegisterDeps; bindings: any[]; pidRegs: Array<{ pid: number; session: string }>; posts: any[] } {
  const bindings: any[] = [];
  const pidRegs: Array<{ pid: number; session: string }> = [];
  const posts: any[] = [];
  const deps: LaneRegisterDeps = {
    panePid: () => opts.panePid,
    childPids: (pid) => opts.tree[pid] ?? [],
    sessionIdForPid: (pid) => opts.sessionIds[pid] ?? null,
    writeBinding: (id, payload) => bindings.push({ id, payload }),
    registerPid: (pid, session) => pidRegs.push({ pid, session }),
    postRegister: async (project, session, id) => { posts.push({ project, session, id }); return true; },
    ...opts.overrides,
  };
  return { deps, bindings, pidRegs, posts };
}

describe('resolveLaneClaudeSession', () => {
  it('finds the Claude PID as the pane-shell descendant that has a session-id file', () => {
    // pane shell 100 → child claude 200 (has the session-id file).
    const { deps } = makeDeps({ panePid: 100, tree: { 100: [200], 200: [] }, sessionIds: { 200: UUID } });
    expect(resolveLaneClaudeSession('mc-x', deps)).toEqual({ pid: 200, claudeSessionId: UUID });
  });

  it('walks deeper than one level (claude under a wrapper process)', () => {
    const { deps } = makeDeps({ panePid: 100, tree: { 100: [150], 150: [220], 220: [] }, sessionIds: { 220: UUID } });
    expect(resolveLaneClaudeSession('mc-x', deps)).toEqual({ pid: 220, claudeSessionId: UUID });
  });

  it('returns null when no descendant has a session-id file', () => {
    const { deps } = makeDeps({ panePid: 100, tree: { 100: [200], 200: [] }, sessionIds: {} });
    expect(resolveLaneClaudeSession('mc-x', deps)).toBeNull();
  });

  it('returns null when the pane PID cannot be resolved', () => {
    const { deps } = makeDeps({ panePid: null, tree: {}, sessionIds: {} });
    expect(resolveLaneClaudeSession('mc-x', deps)).toBeNull();
  });

  it('does not loop forever on a cyclic process tree', () => {
    const { deps } = makeDeps({ panePid: 1, tree: { 1: [2], 2: [1] }, sessionIds: {} });
    expect(resolveLaneClaudeSession('mc-x', deps)).toBeNull();
  });
});

describe('registerLaneClaudeSession', () => {
  it('writes a binding, registers the pid→session map, and POSTs to the API', async () => {
    const { deps, bindings, pidRegs, posts } = makeDeps({
      panePid: 100, tree: { 100: [200], 200: [] }, sessionIds: { 200: UUID },
    });
    const r = await registerLaneClaudeSession({ project: '/p', session: 'backend-1', tmux: 'mc-x' }, deps);
    expect(r.registered).toBe(true);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe(UUID);
    expect(bindings[0].payload).toMatchObject({ project: '/p', session: 'backend-1', claudePid: '200', claudeSessionId: UUID });
    expect(pidRegs).toEqual([{ pid: 200, session: 'backend-1' }]);
    expect(posts).toEqual([{ project: '/p', session: 'backend-1', id: UUID }]);
  });

  it('reports not-registered (no throw) when the lane has no resolvable Claude session', async () => {
    const { deps, bindings, posts } = makeDeps({ panePid: 100, tree: { 100: [] }, sessionIds: {} });
    const r = await registerLaneClaudeSession({ project: '/p', session: 's', tmux: 'mc-x' }, deps);
    expect(r.registered).toBe(false);
    expect(r.reason).toBe('no-claude-session-id');
    expect(bindings).toHaveLength(0);
    expect(posts).toHaveLength(0);
  });

  it('surfaces an api-post failure without throwing', async () => {
    const { deps } = makeDeps({
      panePid: 100, tree: { 100: [200], 200: [] }, sessionIds: { 200: UUID },
      overrides: { postRegister: async () => false },
    });
    const r = await registerLaneClaudeSession({ project: '/p', session: 's', tmux: 'mc-x' }, deps);
    expect(r.registered).toBe(false);
    expect(r.reason).toBe('api-post-failed');
  });
});
