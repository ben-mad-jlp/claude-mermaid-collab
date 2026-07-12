import { describe, it, expect } from 'bun:test';
import {
  impactedSuiteGatePlugin,
  runManifestCommand,
  type GateSubject,
} from '../gate-runner';
import type { LeafGateConfig } from '../leaf-gate';

function makeCtx(over: Partial<GateSubject> & { manifest?: any; laneCwd?: string }): GateSubject & { _calls: any[] } {
  const calls: Array<{ cmd: string[]; cwd?: string }> = [];
  const ctx = {
    project: '/track',
    gateProject: '/main',
    todoId: 't1',
    todo: { id: 't1', type: 'backend' } as any,
    manifest: { gateCommand: 'npx tsc --noEmit' },
    exec: async (cmd: string[], opts: { cwd?: string }) => {
      calls.push({ cmd, cwd: opts.cwd });
      // Default: succeed
      return { code: 0, stdout: '', stderr: '' };
    },
    laneCwd: undefined,
    ...over,
  } as GateSubject & { _calls: any[] };
  (ctx as any)._calls = calls;
  return ctx;
}

function gitStatusFor(paths: string[]): { code: number; stdout: string; stderr: string } {
  const lines = paths.map((p) => `?? ${p}`).join('\n');
  return { code: 0, stdout: lines, stderr: '' };
}

function gitDiffFor(paths: string[]): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: paths.join('\n'), stderr: '' };
}

describe('gate-runner-land-parity: Class (a) — un-narrowed tsc in isolated lane', () => {
  it('regression: lane-scoped subject, tsc fails on unedited file → rejected UN-NARROWED', async () => {
    // Class (a): under worker isolation (laneCwd set), tsc failure on files outside
    // the change-set should REJECT, not false-pass via scopeFailureToChangeSet.
    // The change-set contains only app.ts; the tsc error is on types.ts (unedited).
    const changeSetFile = 'src/app.ts';
    const ctx = makeCtx({
      laneCwd: '/lane/cwd',
      integrationBase: 'master',
      manifest: {
        gateCommand: 'npx tsc --noEmit',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        // git diff master..HEAD returns the change-set
        if (joined.includes('git') && joined.includes('diff')) {
          return gitDiffFor([changeSetFile]);
        }
        // git status --porcelain (for uncommitted edits)
        if (joined.includes('git') && joined.includes('status')) {
          return gitStatusFor([]);
        }
        // tsc fails with a diagnostic in types.ts (NOT in change-set)
        if (joined.includes('tsc')) {
          return {
            code: 1,
            stdout: '',
            stderr: 'src/types.ts(10,5): error TS2345: type mismatch',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const v = await runManifestCommand(ctx);
    expect(v).not.toBeNull();
    expect(v?.passed).toBe(false);
    // Verify it rejected without narrowing (no scopedGate metric).
    expect((v?.metrics as any)?.unNarrowedTypecheck).toBe(true);
  });

  it('non-lane (shared tree) with same tsc failure → old behavior: narrowed via scopeFailureToChangeSet', async () => {
    // Without laneCwd, the old narrowing behavior should kick in.
    // If the tsc error is in a file outside the change-set, scopeFailureToChangeSet
    // should false-pass it.
    const changeSetFile = 'src/app.ts';
    const ctx = makeCtx({
      laneCwd: undefined, // No isolation
      manifest: {
        gateCommand: 'npx tsc --noEmit',
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');
        // git status returns the change-set (shared tree, no diff)
        if (joined.includes('git') && joined.includes('status')) {
          return gitStatusFor([changeSetFile]);
        }
        // tsc fails with a diagnostic in types.ts (NOT in change-set)
        if (joined.includes('tsc')) {
          return {
            code: 1,
            stdout: '',
            stderr: 'src/types.ts(10,5): error TS2345: type mismatch',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const v = await runManifestCommand(ctx);
    expect(v).not.toBeNull();
    // Without laneCwd, narrowing applies — foreign errors false-pass.
    expect(v?.passed).toBe(true);
    expect((v?.metrics as any)?.scopedGate).toBe(true);
  });
});

describe('gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared', () => {
  it('impactedSuiteGatePlugin.appliesTo returns true when test lanes exist', () => {
    const gateConfig: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      tests: [
        {
          match: /.*\.test\.ts$/,
          command: 'bun test {file}',
          mode: 'per-file',
        },
      ] as any,
    };

    const ctx = makeCtx({
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        gate: gateConfig as any,
      },
    });

    expect(impactedSuiteGatePlugin.appliesTo(ctx, 'backend')).toBe(true);
  });

  it('impactedSuiteGatePlugin.appliesTo returns false when no gate declared', () => {
    const ctx = makeCtx({
      manifest: { gateCommand: 'npx tsc --noEmit' }, // No gate block
    });

    expect(impactedSuiteGatePlugin.appliesTo(ctx, 'backend')).toBe(false);
  });

  it('plugin with no test lanes in change-set → passed (abstain)', async () => {
    const nonSpecFile = 'src/app.ts';

    const gateConfig: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      tests: [
        {
          match: /.*\.test\.ts$/,
          command: 'bun test {file}',
          mode: 'per-file',
        },
      ] as any,
    };

    const ctx = makeCtx({
      laneCwd: '/lane/cwd',
      integrationBase: 'master',
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        gate: gateConfig as any,
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');

        if (joined.includes('git') && joined.includes('diff')) {
          // No test files in change-set, only a regular file
          return gitDiffFor([nonSpecFile]);
        }
        if (joined.includes('git') && joined.includes('status')) {
          return gitStatusFor([]);
        }
        if (joined.includes('tsc')) {
          return { code: 0, stdout: '', stderr: '' };
        }

        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const v = await impactedSuiteGatePlugin.run(ctx);
    expect(v).not.toBeNull();
    // When no spec files in change-set, plugin should pass (nothing to test).
    expect(v?.passed).toBe(true);
    expect((v?.metrics as any)?.impactedSuiteGate).toBe(true);
  });


  it('Class (b): impactedSuiteGatePlugin runs when test lanes declared and change-set empty', async () => {
    // Class (b) verification: plugin applies when test lanes are declared and triggers
    // tsc first, then returns pass when no test files are in change-set (abstain).
    // This tests the integration but with a simpler scenario than full baseline testing.
    const gateConfig: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      tests: [
        {
          match: /.*\.test\.ts$/,
          command: 'bun test {files}',
          mode: 'per-file',
        },
      ] as any,
    };

    const ctx = makeCtx({
      laneCwd: '/lane/cwd',
      integrationBase: 'master',
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        gate: gateConfig as any,
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');

        // Change-set queries: no test files
        if (cmd.includes('diff')) {
          return gitDiffFor(['src/app.ts']); // Only non-test module
        }
        if (cmd.includes('status')) {
          return gitStatusFor([]);
        }

        // Typecheck passes
        if (joined.includes('tsc')) {
          return { code: 0, stdout: '', stderr: '' };
        }

        // Git and fs operations — verified to go through ctx.exec in code review
        if (cmd.includes('worktree')) return { code: 0, stdout: '', stderr: '' };
        if (cmd[0] === 'ln') return { code: 0, stdout: '', stderr: '' };
        if (cmd[0] === 'test') return { code: 0, stdout: '', stderr: '' };
        if (cmd[0] === 'cat') return { code: 0, stdout: 'import { x } from "unrelated";', stderr: '' };

        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const result = await impactedSuiteGatePlugin.run(ctx);
    expect(result).not.toBeNull();
    // No test files in change-set → abstain (pass)
    expect(result?.passed).toBe(true);
    expect((result?.metrics as any)?.impactedSuiteGate).toBe(true);
  });

  it('Class (b): net-new failing test in impacted consumer spec → REJECTED', async () => {
    // The leaf edits src/util.ts and src/app.test.ts (which imports util).
    // app.test.ts fails with a test name absent from master baseline.
    // This should REJECT because of the net-new failure (acceptance criterion 6).
    const gateConfig: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      tests: [
        {
          match: /.*\.test\.ts$/,
          command: 'bun test {files}',
          mode: 'per-file',
        },
      ] as any,
    };

    let runPhase = 'branch'; // Track whether we're in branch or baseline run

    const ctx = makeCtx({
      laneCwd: '/lane/cwd',
      integrationBase: 'master',
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        gate: gateConfig as any,
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');

        // Change-set queries only happen early
        if (joined.includes('git') && joined.includes('diff')) {
          runPhase = 'branch';
          return gitDiffFor(['src/util.ts', 'src/app.test.ts']);
        }
        if (joined.includes('git') && joined.includes('status')) {
          return gitStatusFor([]);
        }

        // Typecheck passes
        if (joined.includes('tsc')) {
          return { code: 0, stdout: '', stderr: '' };
        }

        // Worktree add transitions to baseline phase
        if (joined.includes('worktree') && joined.includes('add')) {
          runPhase = 'baseline';
          return { code: 0, stdout: '', stderr: '' };
        }

        // Node modules checks
        if (cmd[0] === 'test' || cmd[0] === 'ln') {
          return { code: 0, stdout: '', stderr: '' };
        }

        // "cat" to read spec file
        if (cmd[0] === 'cat') {
          return { code: 0, stdout: 'import { func } from "./util.ts"; describe("app", () => { it("uses func", () => {}) });', stderr: '' };
        }

        // Test runs differ by phase
        if (joined.includes('bun') && joined.includes('test')) {
          if (runPhase === 'branch') {
            // Branch: fails with net-new failure
            return { code: 1, stdout: 'FAIL src/app.test.ts\n× func integration broken', stderr: '' };
          } else {
            // Baseline: passes (failure is net-new)
            return { code: 0, stdout: 'PASS src/app.test.ts', stderr: '' };
          }
        }

        // Worktree cleanup
        if (joined.includes('worktree') && (joined.includes('remove') || joined.includes('prune'))) {
          return { code: 0, stdout: '', stderr: '' };
        }

        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const result = await impactedSuiteGatePlugin.run(ctx);
    expect(result).not.toBeNull();
    // Should REJECT because of net-new failures.
    expect(result?.passed).toBe(false);
    expect((result?.metrics as any)?.impactedSuiteGate).toBe(true);
    const netNewFailures = (result?.metrics as any)?.netNewFailures ?? [];
    expect(netNewFailures.length).toBeGreaterThan(0);
    expect(netNewFailures.some((f: string) => f.includes('func integration broken'))).toBe(true);
  });

  it('Class (b): baseline-present failure (not net-new) → PASSED (inherited)', async () => {
    // Same scenario as above, but the failure IS present in the baseline.
    // This means the leaf did not cause it — it's inherited from master.
    // The gate should PASS because netNewFailures is empty.
    const gateConfig: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      tests: [
        {
          match: /.*\.test\.ts$/,
          command: 'bun test {files}',
          mode: 'per-file',
        },
      ] as any,
    };

    let runPhase = 'branch';

    const ctx = makeCtx({
      laneCwd: '/lane/cwd',
      integrationBase: 'master',
      manifest: {
        gateCommand: 'npx tsc --noEmit',
        gate: gateConfig as any,
      },
      exec: async (cmd: string[], opts: { cwd?: string }) => {
        const joined = cmd.join(' ');

        // Change-set queries
        if (joined.includes('git') && joined.includes('diff')) {
          runPhase = 'branch';
          return gitDiffFor(['src/util.ts', 'src/app.test.ts']);
        }
        if (joined.includes('git') && joined.includes('status')) {
          return gitStatusFor([]);
        }

        // Typecheck passes
        if (joined.includes('tsc')) {
          return { code: 0, stdout: '', stderr: '' };
        }

        // Worktree transitions to baseline
        if (joined.includes('worktree') && joined.includes('add')) {
          runPhase = 'baseline';
          return { code: 0, stdout: '', stderr: '' };
        }

        // Node modules
        if (cmd[0] === 'test' || cmd[0] === 'ln') {
          return { code: 0, stdout: '', stderr: '' };
        }

        // "cat" reads spec
        if (cmd[0] === 'cat') {
          return { code: 0, stdout: 'import { func } from "./util.ts"; describe("app", () => { it("uses func", () => {}) });', stderr: '' };
        }

        // Test runs: BOTH phase have the same failure (inherited)
        if (joined.includes('bun') && joined.includes('test')) {
          // Both branch and baseline fail with the same test name
          return { code: 1, stdout: 'FAIL src/app.test.ts\n× func integration broken', stderr: '' };
        }

        // Worktree cleanup
        if (joined.includes('worktree') && (joined.includes('remove') || joined.includes('prune'))) {
          return { code: 0, stdout: '', stderr: '' };
        }

        return { code: 0, stdout: '', stderr: '' };
      },
    });

    const result = await impactedSuiteGatePlugin.run(ctx);
    expect(result).not.toBeNull();
    // Should PASS because the failure is baseline-present (inherited, not net-new).
    expect(result?.passed).toBe(true);
    expect((result?.metrics as any)?.impactedSuiteGate).toBe(true);
    const baselineOnly = (result?.metrics as any)?.baselineOnly ?? [];
    expect(baselineOnly.length).toBeGreaterThan(0);
    expect(baselineOnly.some((f: string) => f.includes('func integration broken'))).toBe(true);
  });
});
