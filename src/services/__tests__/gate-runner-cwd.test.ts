import { describe, it, expect } from 'bun:test';
import { manifestCommandGatePlugin, type GateSubject } from '../gate-runner';

/** Build a GateSubject whose exec records the cwd it was invoked with and exits 0
 *  (so the gate short-circuits to passed:true without needing change-set introspection). */
function subjectCapturing(over: Partial<GateSubject>): { ctx: GateSubject; usedCwd: () => string | undefined } {
  let used: string | undefined;
  const ctx = {
    project: '/track',
    gateProject: '/main-checkout',
    todoId: 't1',
    todo: null,
    manifest: { gateCommand: 'python3.10 -m pytest bsync-tools/tests/x.py -q' } as never,
    exec: async (_cmd: string[], opts: { cwd?: string }) => {
      used = opts.cwd;
      return { code: 0, stdout: '', stderr: '' };
    },
    ...over,
  } as GateSubject;
  return { ctx, usedCwd: () => used };
}

describe('manifestCommandGatePlugin — gate runs in the lane worktree', () => {
  it('runs in laneCwd (the leaf worktree) when worker isolation is ON', async () => {
    const { ctx, usedCwd } = subjectCapturing({ laneCwd: '/wt/leaf-exec-abc123' });
    const v = await manifestCommandGatePlugin.run(ctx);
    expect(v?.passed).toBe(true);
    // The bug was that this gate ran in gateProject (main) → tested stale code for
    // cwd-relative resolution (e.g. a Python gate importing a path-resident package).
    expect(usedCwd()).toBe('/wt/leaf-exec-abc123');
  });

  it('falls back to gateProject (main checkout) when isolation is OFF (no laneCwd)', async () => {
    const { ctx, usedCwd } = subjectCapturing({ laneCwd: undefined });
    const v = await manifestCommandGatePlugin.run(ctx);
    expect(v?.passed).toBe(true);
    expect(usedCwd()).toBe('/main-checkout');
  });
});
