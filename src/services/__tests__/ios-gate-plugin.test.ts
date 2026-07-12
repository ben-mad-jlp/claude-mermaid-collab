import { describe, it, expect } from 'bun:test';
import { resolveGatePlugin, listGatePlugins, type GateSubject, type GateExec } from '../gate-runner';
import { iosSwiftGatePlugin } from '../ios-gate-plugin';
import type { ProjectManifest } from '../../config/project-manifest';

/** Build a GateSubject with a stub exec for testing. */
function makeSubject(overrides: Partial<GateSubject> & { exec?: GateExec }): GateSubject {
  return {
    project: '/track',
    gateProject: '/main-checkout',
    todoId: 't1',
    todo: null,
    manifest: { gateCommand: 'npx tsc --noEmit' } as ProjectManifest,
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    ...overrides,
  } as GateSubject;
}

describe('ios-swift gate plugin', () => {
  it('is registered in the plugin registry', () => {
    const plugins = listGatePlugins();
    expect(plugins.some((p) => p.id === 'ios-swift')).toBe(true);
  });

  it('has tier "domain"', () => {
    expect(iosSwiftGatePlugin.tier).toBe('domain');
  });

  it('appliesTo returns true for type="ios"', () => {
    const ctx = makeSubject({});
    expect(iosSwiftGatePlugin.appliesTo(ctx, 'ios')).toBe(true);
  });

  it('appliesTo returns false for non-ios types', () => {
    const ctx = makeSubject({});
    expect(iosSwiftGatePlugin.appliesTo(ctx, 'backend')).toBe(false);
    expect(iosSwiftGatePlugin.appliesTo(ctx, 'frontend')).toBe(false);
    expect(iosSwiftGatePlugin.appliesTo(ctx, null)).toBe(false);
  });

  it('resolveGatePlugin returns ios-swift for type="ios" (domain out-resolves manifest-command)', () => {
    const ctx = makeSubject({});
    const resolved = resolveGatePlugin(ctx, 'ios');
    expect(resolved).toBeTruthy();
    expect(resolved?.id).toBe('ios-swift');
  });

  it('resolveGatePlugin returns manifest-command for type="backend" (non-ios)', () => {
    const ctx = makeSubject({});
    const resolved = resolveGatePlugin(ctx, 'backend');
    expect(resolved).toBeTruthy();
    expect(resolved?.id).toBe('manifest-command');
  });

  it('fails CLOSED on swift test non-zero exit', async () => {
    let callCount = 0;
    const ctx = makeSubject({
      exec: async (_cmd: string[], opts: { cwd?: string; capture?: boolean }) => {
        callCount++;
        // Step (a) swift test fails with code 1
        if (callCount === 1) {
          return { code: 1, stdout: 'test output', stderr: 'test failed' };
        }
        // Step (b) should never be reached
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const result = await iosSwiftGatePlugin.run(ctx);
    expect(result?.passed).toBe(false);
    expect(result?.reasons.length).toBeGreaterThan(0);
    expect(result?.reasons[0]).toContain('swift test');
    // Only the first call should have been made
    expect(callCount).toBe(1);
  });

  it('fails CLOSED on xcodebuild non-zero exit', async () => {
    let callCount = 0;
    const ctx = makeSubject({
      exec: async (_cmd: string[], opts: { cwd?: string; capture?: boolean }) => {
        callCount++;
        if (callCount === 1) {
          // Step (a) swift test succeeds
          return { code: 0, stdout: '', stderr: '' };
        } else if (callCount === 2) {
          // Step (b) xcodebuild fails with code 1
          return { code: 1, stdout: 'build output', stderr: 'build failed' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const result = await iosSwiftGatePlugin.run(ctx);
    expect(result?.passed).toBe(false);
    expect(result?.reasons.length).toBeGreaterThan(0);
    expect(result?.reasons[0]).toContain('xcodebuild');
    // Both calls should have been made
    expect(callCount).toBe(2);
  });

  it('passes when both swift test and xcodebuild succeed', async () => {
    let callCount = 0;
    const ctx = makeSubject({
      exec: async (_cmd: string[], opts: { cwd?: string; capture?: boolean }) => {
        callCount++;
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const result = await iosSwiftGatePlugin.run(ctx);
    expect(result?.passed).toBe(true);
    expect(result?.reasons.length).toBe(0);
    expect(result?.metrics?.iosSwiftGate).toBe(true);
    // Both steps should have been executed
    expect(callCount).toBe(2);
  });

  it('fails CLOSED on exec throwing an error', async () => {
    const ctx = makeSubject({
      exec: async (_cmd: string[]) => {
        throw new Error('exec died');
      },
    });

    const result = await iosSwiftGatePlugin.run(ctx);
    expect(result?.passed).toBe(false);
    expect(result?.reasons[0]).toContain('could not run');
    expect(result?.reasons[0]).toContain('exec died');
  });

  it('uses laneCwd when present, falls back to gateProject', async () => {
    const usedCwds: string[] = [];
    const ctx = makeSubject({
      laneCwd: '/wt/leaf-exec-abc123',
      gateProject: '/main-checkout',
      exec: async (_cmd: string[], opts: { cwd?: string }) => {
        usedCwds.push(opts.cwd ?? '');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    await iosSwiftGatePlugin.run(ctx);
    expect(usedCwds).toEqual(['/wt/leaf-exec-abc123', '/wt/leaf-exec-abc123']);
  });

  it('uses gateProject when laneCwd is absent', async () => {
    const usedCwds: string[] = [];
    const ctx = makeSubject({
      laneCwd: undefined,
      gateProject: '/main-checkout',
      exec: async (_cmd: string[], opts: { cwd?: string }) => {
        usedCwds.push(opts.cwd ?? '');
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    await iosSwiftGatePlugin.run(ctx);
    expect(usedCwds).toEqual(['/main-checkout', '/main-checkout']);
  });
});
