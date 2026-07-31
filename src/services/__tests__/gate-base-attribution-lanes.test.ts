import { describe, it, expect } from 'bun:test';
import {
  manifestCommandGatePlugin,
  frontendSuiteGatePlugin,
  changeSetTestGatePlugin,
  impactedSuiteGatePlugin,
  type GateSubject,
} from '../gate-runner';

const OWN_FILE = 'src/own.test.ts';
const FOREIGN_FILE = 'src/foreign-file.ts';
const COMMAND = 'run-gate';
// The exact string impactedSuiteGatePlugin's {files}-template lane expands to for
// OWN_FILE (via leaf-gate's shellQuote) — used as the literal command for the other
// three plugins too, so all four lanes classify the SAME (command, failing-file) pair.
const EXPANDED_COMMAND = `${COMMAND} 'src/own.test.ts'`;

function gitStatusFor(paths: string[]): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: paths.map((p) => `?? ${p}`).join('\n'), stderr: '' };
}

function gitDiffFor(paths: string[]): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: paths.join('\n'), stderr: '' };
}

function baseCtx(over: Partial<GateSubject> & { manifest?: any }): GateSubject {
  return {
    project: '/track',
    gateProject: '/main',
    todoId: 't1',
    todo: { id: 't1', type: 'ui' } as any,
    manifest: {},
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    laneCwd: '/lane',
    integrationBase: 'collab/epic/abc',
    ...over,
  } as GateSubject;
}

describe('base-attribution wired into all four gate lanes', () => {
  it('all four gate lanes agree on baseAttributed.signature for the same base-red failure', async () => {
    const foreignOut = `FAIL ${FOREIGN_FILE}\n`;

    // 1. manifestCommandGatePlugin (laneCwd/typecheck RED path).
    const manifestCtx = baseCtx({
      manifest: { gateCommand: EXPANDED_COMMAND },
      ownChangeSet: [OWN_FILE],
      exec: async (cmd: string[]) => {
        if (cmd.join(' ').includes(COMMAND)) return { code: 1, stdout: foreignOut, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const manifestVerdict = await manifestCommandGatePlugin.run(manifestCtx);

    // 2. frontendSuiteGatePlugin (net-new-failure RED path).
    const frontendCtx = baseCtx({
      manifest: { frontendGateCommand: EXPANDED_COMMAND },
      ownChangeSet: [OWN_FILE],
      exec: async (cmd: string[]) => {
        if (cmd.join(' ').includes(COMMAND)) return { code: 1, stdout: foreignOut, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const frontendVerdict = await frontendSuiteGatePlugin.run(frontendCtx);

    // 3. changeSetTestGatePlugin (own-spec-failure RED path).
    const changeSetCtx = baseCtx({
      manifest: { gateCommand: 'true', changeSetTestCommand: EXPANDED_COMMAND, changeSetTestCwd: undefined },
      ownChangeSet: [OWN_FILE],
      exec: async (cmd: string[]) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor([OWN_FILE]);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor([OWN_FILE]);
        if (joined.includes('true')) return { code: 0, stdout: '', stderr: '' };
        if (joined.includes(COMMAND)) return { code: 1, stdout: foreignOut, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const changeSetVerdict = await changeSetTestGatePlugin.run(changeSetCtx);

    // 4. impactedSuiteGatePlugin (post-baseline net-new-failure RED path). Its
    // {files}-template lane expands to EXPANDED_COMMAND for OWN_FILE (leaf-gate's
    // shellQuote), so its classify call sees the same command as the other three.
    const impactedCtx = baseCtx({
      todo: { id: 't1', type: 'backend' } as any,
      manifest: {
        gate: {
          tests: [{ match: '^src/', command: `${COMMAND} {files}`, mode: 'batch' }],
        },
      } as any,
      ownChangeSet: [OWN_FILE],
      exec: async (cmd: string[], opts: { cwd?: string } = {}) => {
        const joined = cmd.join(' ');
        if (joined.includes('git') && joined.includes('status')) return gitStatusFor([OWN_FILE]);
        if (joined.includes('git') && joined.includes('diff')) return gitDiffFor([OWN_FILE]);
        if (joined.includes('worktree')) return { code: 0, stdout: '', stderr: '' };
        if (joined.includes('test -d') || joined.includes('test -e')) return { code: 1, stdout: '', stderr: '' };
        if (joined.includes(COMMAND)) {
          // Baseline run (trial worktree) is green; the real lane run is red.
          const isBaseline = (opts.cwd ?? '').includes('collab-impacted-gate');
          if (isBaseline) return { code: 0, stdout: '', stderr: '' };
          return { code: 1, stdout: foreignOut, stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const impactedVerdict = await impactedSuiteGatePlugin.run(impactedCtx);

    for (const v of [manifestVerdict, frontendVerdict, changeSetVerdict, impactedVerdict]) {
      expect(v?.passed).toBe(false);
      expect(v?.baseAttributed).toBeTruthy();
    }
    const signatures = [manifestVerdict, frontendVerdict, changeSetVerdict, impactedVerdict].map(
      (v) => v?.baseAttributed?.signature,
    );
    expect(new Set(signatures).size).toBe(1);
  });

  it('an in-change-set failure yields a plain reject with no baseAttributed', async () => {
    const ownOut = `FAIL ${OWN_FILE}\n`;
    const ctx = baseCtx({
      manifest: { gateCommand: COMMAND },
      ownChangeSet: [OWN_FILE],
      exec: async (cmd: string[]) => {
        if (cmd.join(' ').includes(COMMAND)) return { code: 1, stdout: ownOut, stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const verdict = await manifestCommandGatePlugin.run(ctx);
    expect(verdict?.passed).toBe(false);
    expect(verdict?.baseAttributed).toBeUndefined();
    expect((verdict?.metrics as any)?.unNarrowedTypecheck).toBe(true);
  });
});
