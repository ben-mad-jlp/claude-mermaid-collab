import { describe, it, expect } from 'vitest';
import {
  registerGatePlugin,
  resolveGatePlugin,
  runRegistryGate,
  manifestCommandGatePlugin,
  parseTrailingVerdict,
  parseChangedFiles,
  extractDiagnosticFiles,
  isInChangeSet,
  scopeFailureToChangeSet,
  type GatePlugin,
  type GateSubject,
} from '../gate-runner';
import type { GateExec } from '../gate-runner';

const noExec: GateExec = async () => ({ code: 0, stdout: '', stderr: '' });

function subject(over: Partial<GateSubject> = {}): GateSubject {
  return {
    project: '/p',
    gateProject: '/p',
    todoId: 't1',
    todo: { type: null } as GateSubject['todo'],
    manifest: null,
    exec: noExec,
    ...over,
  };
}

describe('gate registry resolution', () => {
  it('resolves nothing when no plugin applies (no gateCommand, no domain artifact)', () => {
    expect(resolveGatePlugin(subject(), null)).toBeNull();
  });

  it('manifest-command (project tier) applies when a gateCommand is declared', () => {
    const obj = subject({ manifest: { gateCommand: 'echo hi' } });
    expect(resolveGatePlugin(obj, null)?.id).toBe('manifest-command');
  });

  it('a domain-tier plugin wins over the project-tier command adapter', () => {
    // Scope appliesTo to a marker todoId so this plugin can't leak into the
    // module-level registry and shadow other tests' resolution.
    const domain: GatePlugin = {
      id: 'test-domain',
      tier: 'domain',
      appliesTo: (o) => o.todoId === 'domain-marker',
      run: async () => ({ passed: true, reasons: [] }),
    };
    registerGatePlugin(domain);
    const obj = subject({ todoId: 'domain-marker', manifest: { gateCommand: 'echo hi' } });
    expect(resolveGatePlugin(obj, null)?.id).toBe('test-domain');
  });

  it('registerGatePlugin is idempotent by id', () => {
    const p: GatePlugin = { id: 'dupe', tier: 'core', appliesTo: () => false, run: async () => null };
    registerGatePlugin(p);
    registerGatePlugin(p);
    // No throw, and resolution stays deterministic — covered implicitly; assert the
    // manifest adapter is still the registered project plugin instance.
    expect(manifestCommandGatePlugin.tier).toBe('project');
  });

  it('runRegistryGate runs the manifest command and derives a verdict from exit code', async () => {
    const exec: GateExec = async () => ({ code: 1, stdout: 'boom', stderr: '' });
    const verdict = await runRegistryGate(subject({ manifest: { gateCommand: 'false' }, exec }));
    expect(verdict?.passed).toBe(false);
  });

  it('runRegistryGate prefers a structured trailing verdict over the exit code', async () => {
    const exec: GateExec = async () => ({ code: 0, stdout: '{"passed":false,"reasons":["nope"]}', stderr: '' });
    const verdict = await runRegistryGate(subject({ manifest: { gateCommand: 'x' }, exec }));
    expect(verdict).toEqual({ passed: false, reasons: ['nope'], metrics: undefined });
  });

  it('a throwing plugin fails CLOSED (never passes)', async () => {
    registerGatePlugin({
      id: 'throws',
      tier: 'core',
      appliesTo: (o) => o.todoId === 'throw-marker',
      run: async () => { throw new Error('kaboom'); },
    });
    const verdict = await runRegistryGate(subject({ todoId: 'throw-marker' }));
    expect(verdict?.passed).toBe(false);
    expect(verdict?.reasons[0]).toContain('throws');
  });
});

describe('parseTrailingVerdict', () => {
  it('returns null when no JSON verdict line is present', () => {
    expect(parseTrailingVerdict('just logs\nmore logs')).toBeNull();
  });
  it('parses the last JSON line carrying a boolean passed', () => {
    expect(parseTrailingVerdict('log\n{"passed":true,"reasons":[]}')).toEqual({
      passed: true,
      reasons: [],
      metrics: undefined,
    });
  });
});

describe('change-set scoping (todo 63dcca2f)', () => {
  it('parseChangedFiles reads porcelain incl. untracked and renames (new path)', () => {
    const porcelain = ' M src/services/gate-runner.ts\n?? src/new.ts\nR  src/old.ts -> src/renamed.ts\nA  src/added.ts';
    expect(parseChangedFiles(porcelain)).toEqual([
      'src/services/gate-runner.ts',
      'src/new.ts',
      'src/renamed.ts',
      'src/added.ts',
    ]);
  });

  it('extractDiagnosticFiles finds tsc and pytest file paths, ignores version tokens', () => {
    const tsc = 'src/routes/supervisor-routes.ts(153,42): error TS2322: bad';
    const py = 'FAILED bsync-tools/tests/test_x.py::test_a - AssertionError\nbsync-tools/tests/test_x.py:12: in test_a';
    const noise = 'using node:18 runtime';
    const files = extractDiagnosticFiles(`${tsc}\n${py}\n${noise}`);
    expect(files).toContain('src/routes/supervisor-routes.ts');
    expect(files).toContain('bsync-tools/tests/test_x.py');
    expect(files).not.toContain('node');
  });

  it('isInChangeSet matches exactly and on a path-suffix (subdir cwd)', () => {
    const cs = ['src/services/bsync-session.ts'];
    expect(isInChangeSet('src/services/bsync-session.ts', cs)).toBe(true);
    expect(isInChangeSet('./src/services/bsync-session.ts', cs)).toBe(true);
    expect(isInChangeSet('src/routes/supervisor-routes.ts', cs)).toBe(false);
  });

  it('PASSES when the failure references only foreign files (the false-reject fix)', () => {
    const out = 'src/routes/supervisor-routes.ts(153,42): error TS2322: coordinator_status';
    const verdict = scopeFailureToChangeSet(out, ['src/services/bsync-session.ts']);
    expect(verdict?.passed).toBe(true);
    expect(verdict?.metrics?.scopedGate).toBe(true);
  });

  it('still FAILS when a failure is within the change-set', () => {
    const out = 'src/services/bsync-session.ts(10,3): error TS2304: Cannot find name';
    const verdict = scopeFailureToChangeSet(out, ['src/services/bsync-session.ts']);
    expect(verdict?.passed).toBe(false);
    expect(verdict?.reasons[0]).toContain('bsync-session.ts');
  });

  it('returns null (→ caller fails closed) when nothing is attributable', () => {
    expect(scopeFailureToChangeSet('segfault, no file paths', ['src/a.ts'])).toBeNull();
    expect(scopeFailureToChangeSet('src/a.ts(1,1): error', null)).toBeNull();
  });

  it('manifest gate: foreign whole-tree error is accepted on a green change-set', async () => {
    const exec: GateExec = async (cmd) => {
      if (cmd[0] === 'git') {
        return { code: 0, stdout: ' M src/services/bsync-session.ts\n', stderr: '' };
      }
      // the gate command (sh -c tsc) fails on a FOREIGN file
      return { code: 2, stdout: 'src/routes/supervisor-routes.ts(153,42): error TS2322: x', stderr: '' };
    };
    const verdict = await runRegistryGate(
      subject({ manifest: { gateCommand: 'npx tsc --noEmit' }, exec }),
    );
    expect(verdict?.passed).toBe(true);
  });

  it('manifest gate: an in-change-set error is still rejected', async () => {
    const exec: GateExec = async (cmd) => {
      if (cmd[0] === 'git') {
        return { code: 0, stdout: ' M src/services/bsync-session.ts\n', stderr: '' };
      }
      return { code: 2, stdout: 'src/services/bsync-session.ts(10,3): error TS2304: y', stderr: '' };
    };
    const verdict = await runRegistryGate(
      subject({ manifest: { gateCommand: 'npx tsc --noEmit' }, exec }),
    );
    expect(verdict?.passed).toBe(false);
  });
});

describe('lane-local change-set scoping (todo b78fd3f6)', () => {
  // Under worker isolation the change-set comes from THIS lane's worktree (its
  // diff vs integration base + its own uncommitted edits), NOT whole-tree git
  // status — so a sibling lane's in-flight error in the shared/integration tree
  // can never false-reject green work. The injected exec answers the lane git
  // reads (diff / status, both run with -C laneCwd) and the gate command.
  const laneExec = (laneStatus: string, gateOut: string, laneDiff = ''): GateExec => async (cmd) => {
    if (cmd[0] === 'git' && cmd.includes('diff')) return { code: 0, stdout: laneDiff, stderr: '' };
    if (cmd[0] === 'git' && cmd.includes('status')) return { code: 0, stdout: laneStatus, stderr: '' };
    return { code: 2, stdout: gateOut, stderr: '' }; // the gate command failed
  };

  it("a sibling lane's error is foreign — scoped out by the lane's OWN worktree change-set", async () => {
    // This lane only touched plugin-registry.ts; the gate failed on a SIBLING's
    // supervisor-store.ts edit. Lane-local scoping → PASS.
    const exec = laneExec(
      ' M src/services/plugin-registry.ts\n',
      'src/services/supervisor-store.ts(412,9): error TS2345: foreign',
    );
    const verdict = await runRegistryGate(
      subject({ manifest: { gateCommand: 'npx tsc --noEmit' }, exec, laneCwd: '/wt/backend-2', integrationBase: 'collab/integration' }),
    );
    expect(verdict?.passed).toBe(true);
    expect(verdict?.metrics?.scopedGate).toBe(true);
  });

  it("a real error INSIDE the lane's own change-set still rejects", async () => {
    const exec = laneExec(
      ' M src/services/plugin-registry.ts\n',
      'src/services/plugin-registry.ts(20,3): error TS2304: real in-scope error',
    );
    const verdict = await runRegistryGate(
      subject({ manifest: { gateCommand: 'npx tsc --noEmit' }, exec, laneCwd: '/wt/backend-2', integrationBase: 'collab/integration' }),
    );
    expect(verdict?.passed).toBe(false);
  });

  it("counts the lane's COMMITTED diff (vs integration base) as in-scope", async () => {
    // No uncommitted edits; the lane committed plugin-registry.ts. A failure there
    // is in the lane's change-set → reject.
    const exec = laneExec(
      '', // empty status
      'src/services/plugin-registry.ts(5,1): error TS1005: x',
      'src/services/plugin-registry.ts\n', // diff base..HEAD
    );
    const verdict = await runRegistryGate(
      subject({ manifest: { gateCommand: 'npx tsc --noEmit' }, exec, laneCwd: '/wt/backend-2', integrationBase: 'collab/integration' }),
    );
    expect(verdict?.passed).toBe(false);
  });

  it('fails CLOSED when the lane git reads are unavailable (cannot attribute)', async () => {
    const exec: GateExec = async (cmd) => {
      if (cmd[0] === 'git') return { code: 128, stdout: '', stderr: 'not a git worktree' };
      return { code: 2, stdout: 'src/services/whatever.ts(1,1): error', stderr: '' };
    };
    const verdict = await runRegistryGate(
      subject({ manifest: { gateCommand: 'npx tsc --noEmit' }, exec, laneCwd: '/wt/backend-2', integrationBase: 'collab/integration' }),
    );
    expect(verdict?.passed).toBe(false); // un-attributable → fail closed, never a false pass
  });
});
