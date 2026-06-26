import { describe, test, expect } from 'bun:test';
import { revalidateStaleEpic, type RevalidateDeps } from '../coordinator-live';

const base = (over: Partial<RevalidateDeps>): Partial<RevalidateDeps> => ({
  ensureEpicPath: async () => '/tmp/epic-wt',
  getEpicTodo: () => null,
  manifest: { gateCommand: 'noop' } as any,
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
  ...over,
});

describe('revalidateStaleEpic', () => {
  test('forward-integrate conflict → ok:false forward-integrate-conflict', async () => {
    const r = await revalidateStaleEpic('proj', 'epic1', 'master', base({
      forwardIntegrate: async () => ({ integrated: false, advanced: false, conflict: true, conflictedPaths: ['a.ts'] }),
      runGate: async () => { throw new Error('gate must not run on conflict'); },
    }));
    expect(r).toEqual({ ok: false, reason: 'forward-integrate-conflict', conflictedPaths: ['a.ts'] });
  });

  test('gate red → ok:false revalidation-gate-failed', async () => {
    const r = await revalidateStaleEpic('proj', 'epic1', 'master', base({
      forwardIntegrate: async () => ({ integrated: true, advanced: true, conflict: false }),
      runGate: async () => ({ passed: false, reasons: ['tsc error X'] }),
    }));
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('revalidation-gate-failed');
    expect((r as any).output).toContain('tsc error X');
  });

  test('gate green → ok:true', async () => {
    let gateCwd: string | undefined;
    const r = await revalidateStaleEpic('proj', 'epic1', 'master', base({
      forwardIntegrate: async () => ({ integrated: true, advanced: false, conflict: false }),
      runGate: async (s) => { gateCwd = s.laneCwd; return { passed: true, reasons: [] }; },
    }));
    expect(r).toEqual({ ok: true });
    expect(gateCwd).toBe('/tmp/epic-wt');   // gate ran IN the epic worktree
  });
});
