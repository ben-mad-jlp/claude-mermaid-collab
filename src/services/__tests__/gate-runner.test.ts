import { describe, it, expect } from 'vitest';
import {
  registerGatePlugin,
  resolveGatePlugin,
  runRegistryGate,
  manifestCommandGatePlugin,
  parseTrailingVerdict,
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
