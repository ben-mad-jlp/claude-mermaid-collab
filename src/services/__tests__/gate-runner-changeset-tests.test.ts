import { describe, it, expect } from 'bun:test';
import {
  changeSetTestGatePlugin,
  manifestCommandGatePlugin,
  frontendSuiteGatePlugin,
  resolveGatePlugin,
  type GateSubject,
} from '../gate-runner';

function makeCtx(over: Partial<GateSubject> & { manifest?: any }): GateSubject {
  const calls: Array<{ cmd: string[]; cwd?: string }> = [];
  const ctx = {
    project: '/track',
    gateProject: '/main',
    todoId: 't1',
    todo: { id: 't1', type: 'ui' } as any,
    manifest: { gateCommand: 'npx tsc --noEmit' },
    exec: async (cmd: string[], opts: { cwd?: string }) => {
      calls.push({ cmd, cwd: opts.cwd });
      // Default: succeed
      return { code: 0, stdout: '', stderr: '' };
    },
    ...over,
  } as GateSubject;
  (ctx as any)._calls = calls;
  return ctx;
}

function lastCallCwd(ctx: any): string | undefined {
  const calls = (ctx as any)._calls as Array<{ cwd?: string }>;
  return calls.length ? calls[calls.length - 1].cwd : undefined;
}

function gitStatusFor(paths: string[]): { code: number; stdout: string; stderr: string } {
  // Emulate `git status --porcelain` output for the listed paths (as untracked/modified)
  const lines = paths.map((p) => `?? ${p}`).join('\n');
  return { code: 0, stdout: lines, stderr: '' };
}

function gitDiffFor(paths: string[]): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: paths.join('\n'), stderr: '' };
}

describe('changeSetTestGatePlugin', () => {
  it('regression: ui leaf with red own-spec in change-set is rejected', async () => {
    const spec = 'ui/src/components/supervisor/bridge/funnel.live.test.ts';
    const ctx = makeCtx({
      todo: { id: 't1', type: 'ui' } as any,
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        changeSetTestCommand: 'bunx vitest --run {files}',
        changeSetTestCwd: 'ui',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor([spec]);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor([spec]);
        if (joined.includes('tsc')) return { code: 0, stdout: '', stderr: '' };
        // vitest fails with a recognizable failure line
        return { code: 1, stdout: `FAIL ${spec}\n× my test fails\n`, stderr: '' };
      },
    });
    const v = await changeSetTestGatePlugin.run(ctx);
    expect(v?.passed).toBe(false);
    expect(v?.reasons.some((r) => r.includes('failing test') || r.includes('funnel.live.test'))).toBe(true);
  });

  it('ui leaf, spec command exits 0 → passed, metrics.ranSpecs includes the spec', async () => {
    const spec = 'ui/src/foo.test.ts';
    const ctx = makeCtx({
      todo: { id: 't1', type: 'ui' } as any,
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        changeSetTestCommand: 'bunx vitest --run {files}',
        changeSetTestCwd: 'ui',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor([spec]);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor([spec]);
        if (joined.includes('tsc')) return { code: 0, stdout: '', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const v = await changeSetTestGatePlugin.run(ctx);
    expect(v?.passed).toBe(true);
    expect((v?.metrics as any)?.ranSpecs).toContain('src/foo.test.ts');
  });

  it('ui leaf, change-set has NO spec files → vitest not invoked; verdict is tsc pass', async () => {
    const ctx = makeCtx({
      todo: { id: 't1', type: 'ui' } as any,
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        changeSetTestCommand: 'bunx vitest --run {files}',
        changeSetTestCwd: 'ui',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor(['ui/src/app.tsx']);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor(['ui/src/app.tsx']);
        if (joined.includes('tsc')) return { code: 0, stdout: '', stderr: '' };
        // If vitest were called we would see it; record for assertion
        (ctx as any)._vitestCalled = true;
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const v = await changeSetTestGatePlugin.run(ctx);
    expect(v?.passed).toBe(true);
    expect((ctx as any)._vitestCalled).toBeFalsy();
  });

  it('tsc (gateCommand) fails → reject WITHOUT invoking the test command', async () => {
    const spec = 'ui/src/bar.test.ts';
    let vitestInvoked = false;
    const ctx = makeCtx({
      todo: { id: 't1', type: 'ui' } as any,
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        changeSetTestCommand: 'bunx vitest --run {files}',
        changeSetTestCwd: 'ui',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor([spec]);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor([spec]);
        if (joined.includes('tsc')) return { code: 1, stdout: 'ui/src/bar.test.ts(1,1): error TS1000', stderr: '' };
        vitestInvoked = true;
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const v = await changeSetTestGatePlugin.run(ctx);
    expect(v?.passed).toBe(false);
    expect(v?.reasons.some((r) => r.includes('tsc') || r.includes('exited') || r.includes('change-set'))).toBe(true);
    expect(vitestInvoked).toBe(false);
  });

  it('test command throws (spawn error) → passed === false (fail closed)', async () => {
    const spec = 'ui/src/z.test.ts';
    const ctx = makeCtx({
      todo: { id: 't1', type: 'ui' } as any,
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        changeSetTestCommand: 'bunx vitest --run {files}',
        changeSetTestCwd: 'ui',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor([spec]);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor([spec]);
        if (joined.includes('tsc')) return { code: 0, stdout: '', stderr: '' };
        throw new Error('spawn ENOENT');
      },
    });
    const v = await changeSetTestGatePlugin.run(ctx);
    expect(v?.passed).toBe(false);
    expect(v?.reasons.some((r) => r.includes('could not run'))).toBe(true);
  });

  it('resolveGatePlugin: ui + changeSetTestCommand (no frontendGate) → changeset-test; ui + frontendGate → frontend-suite; non-ui → manifest-command', () => {
    const uiWithCst = {
      project: '/t', gateProject: '/t', todoId: 't', todo: { id: 't', type: 'ui' } as any,
      manifest: { gateCommand: 'npx tsc --noEmit', changeSetTestCommand: 'bunx vitest --run {files}' },
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    } as GateSubject;
    const uiWithFe = {
      ...uiWithCst,
      manifest: { ...uiWithCst.manifest, frontendGateCommand: 'bun test:ci' },
    } as GateSubject;
    const nonUi = {
      ...uiWithCst,
      todo: { id: 't', type: 'backend' } as any,
    } as GateSubject;

    expect(resolveGatePlugin(uiWithCst, 'ui')?.id).toBe('changeset-test');
    expect(resolveGatePlugin(uiWithFe, 'ui')?.id).toBe('frontend-suite');
    expect(resolveGatePlugin(nonUi, 'backend')?.id).toBe('manifest-command');
  });
});

describe('impactedSuiteGatePlugin — raw manifest lanes are compiled, never used verbatim', () => {
  // Regression (mission 96c60653, leaf ac0e1909): the plugin fed resolveLanes the RAW
  // manifest gate block, whose lane `match` fields are strings — routeSpecsToLanes then
  // crashed on l.match.test(spec) ("l.match.test is not a function") and the thrown
  // error fail-closed REJECTED a review-green leaf. The plugin must route through
  // resolveLeafGate so lane matches are validated + compiled to RegExps.
  const RAW_MANIFEST = {
    gate: {
      typecheck: 'true',
      tests: [
        { match: '^src/', command: 'bun test {file}' },
        { match: '^ui/', command: 'bunx vitest --run {files}', cwd: 'ui' },
      ],
    },
  };

  it('appliesTo accepts a raw string-match manifest without throwing', async () => {
    const { impactedSuiteGatePlugin } = await import('../gate-runner');
    const ctx = makeCtx({ manifest: RAW_MANIFEST as any });
    expect(() => impactedSuiteGatePlugin.appliesTo(ctx, 'backend')).not.toThrow();
    expect(impactedSuiteGatePlugin.appliesTo(ctx, 'backend')).toBe(true);
  });

  it('run routes a spec through compiled lanes instead of crashing on string match', async () => {
    const { impactedSuiteGatePlugin } = await import('../gate-runner');
    const ctx = makeCtx({
      manifest: RAW_MANIFEST as any,
      // exec serves: typecheck (code 0), change-set listing, spec runs.
      exec: async (cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('diff') || joined.includes('status')) {
          return { code: 0, stdout: 'src/services/__tests__/foo.test.ts\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const verdict = await impactedSuiteGatePlugin.run(ctx);
    // The exact verdict shape depends on the change-set plumbing; the regression bar
    // is only: no "l.match.test is not a function" crash surfacing as a reject.
    if (verdict && !verdict.passed) {
      expect(verdict.reasons.join(' ')).not.toContain('is not a function');
    }
  });
});
