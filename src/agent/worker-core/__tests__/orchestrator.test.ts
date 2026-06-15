import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { runWorkerCore, type WorkerCoreDeps, type TodoSpec, type GateOutcome } from '../orchestrator';
import type { SubloopRole } from '../capabilities';

function mockModel(text: string) {
  return new MockLanguageModelV3({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }) as any,
  });
}

const RESEARCH_OK = '{"filesToEdit":["a.ts"],"plan":"edit a","behavioral":false}';
const VERIFY_PASS = '{"pass":true,"failingChecks":[],"errorSignatures":[]}';
const VERIFY_FAIL = '{"pass":false,"failingChecks":["x"],"errorSignatures":["e1"]}';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wc-orch-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function makeDeps(over: {
  spec?: TodoSpec | null;
  phaseText: Partial<Record<SubloopRole, string>>;
  gate: (n: number) => GateOutcome;
}): WorkerCoreDeps & { calls: { complete: number; escalate: string[]; gate: number } } {
  const calls = { complete: 0, escalate: [] as string[], gate: 0 };
  return {
    calls,
    getTodo: () => (over.spec === undefined ? { todoId: 't1', title: 'do a thing' } : over.spec),
    resolveModel: (phase: SubloopRole) => mockModel(over.phaseText[phase] ?? 'ok'),
    runScopedGate: vi.fn(async () => over.gate(calls.gate++)),
    completeAccepted: vi.fn(async () => {
      calls.complete++;
    }),
    escalate: vi.fn(async (_p, _t, kind) => {
      calls.escalate.push(kind);
    }),
  };
}

describe('runWorkerCore', () => {
  it('happy path: research → implement → verify+gate green → host completes', async () => {
    const deps = makeDeps({
      phaseText: { research: RESEARCH_OK, implement: 'done', verify: VERIFY_PASS },
      gate: () => ({ pass: true, errorSignatures: [] }),
    });
    const r = await runWorkerCore({ project: 'p', todoId: 't1', cwd }, deps);
    expect(r).toEqual({ outcome: 'completed' });
    expect(deps.calls.complete).toBe(1);
    expect(deps.calls.escalate).toEqual([]);
  });

  it('self-terminating fix loop: identical failures twice → escalate stuck, no completion', async () => {
    const deps = makeDeps({
      phaseText: { research: RESEARCH_OK, implement: 'tried', verify: VERIFY_FAIL },
      gate: () => ({ pass: false, errorSignatures: ['e1'] }),
    });
    const r = await runWorkerCore({ project: 'p', todoId: 't1', cwd }, deps);
    expect(r.outcome).toBe('escalated');
    expect(deps.calls.escalate).toContain('stuck');
    expect(deps.calls.complete).toBe(0);
  });

  it('research yielding no valid findings escalates before any implement', async () => {
    const deps = makeDeps({
      phaseText: { research: 'I could not figure it out' },
      gate: () => ({ pass: true, errorSignatures: [] }),
    });
    const r = await runWorkerCore({ project: 'p', todoId: 't1', cwd }, deps);
    expect(r).toMatchObject({ outcome: 'escalated', kind: 'research-failed' });
    expect(deps.calls.gate).toBe(0); // never reached implement/verify
    expect(deps.calls.complete).toBe(0);
  });

  it('behavioral leaf: a completeness gap escalates instead of completing', async () => {
    const deps = makeDeps({
      spec: { todoId: 't1', title: 'add archive', behavioral: true },
      phaseText: {
        research: RESEARCH_OK,
        implement: 'done',
        verify: VERIFY_PASS,
        review: '{"complete":false,"gaps":["no audit log"]}',
      },
      gate: () => ({ pass: true, errorSignatures: [] }),
    });
    const r = await runWorkerCore({ project: 'p', todoId: 't1', cwd }, deps);
    expect(r).toMatchObject({ outcome: 'escalated', kind: 'incomplete' });
    expect(deps.calls.complete).toBe(0);
  });

  it('forwards observability events from every phase to the sink', async () => {
    const events: { type: string; role?: string }[] = [];
    const deps = makeDeps({
      phaseText: { research: RESEARCH_OK, implement: 'done', verify: VERIFY_PASS },
      gate: () => ({ pass: true, errorSignatures: [] }),
    });
    await runWorkerCore({ project: 'p', todoId: 't1', cwd, onEvent: (e) => events.push(e) }, deps);
    const roles = new Set(events.filter((e) => e.type === 'phase-start').map((e) => e.role));
    expect(roles).toContain('research');
    expect(roles).toContain('implement');
    expect(roles).toContain('verify');
  });

  it('noop when the todo is missing', async () => {
    const deps = makeDeps({ spec: null, phaseText: {}, gate: () => ({ pass: true, errorSignatures: [] }) });
    const r = await runWorkerCore({ project: 'p', todoId: 'gone', cwd }, deps);
    expect(r).toMatchObject({ outcome: 'noop' });
  });
});
