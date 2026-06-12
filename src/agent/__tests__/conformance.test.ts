/**
 * Runs the WorkerAgent conformance harness against the registered providers.
 * Today only `claude` is registered (the kill-switch floor), so this asserts the
 * ClaudeCodeAgent collapses each recorded lifecycle pane into today's booleans —
 * the byte-identical guard for the detector MOVE out of coordinator-live.ts.
 */
import { describe, it, expect } from 'vitest';
import { resolveWorkerAgent, registeredProviders } from '../registry';
import { runConformance, CLAUDE_PANE_FIXTURES } from './conformance';
import { resolveCompletion } from '../completion-resolver';

describe('WorkerAgent conformance', () => {
  it('registers exactly the claude provider (kill-switch floor)', () => {
    expect(registeredProviders()).toEqual(['claude']);
  });

  it('ClaudeCodeAgent is conformant across the recorded lifecycle', () => {
    const agent = resolveWorkerAgent('claude');
    const failures = runConformance(agent);
    expect(failures).toEqual([]);
  });

  it('snapshot yields a normalized event for every fixture pane', () => {
    const agent = resolveWorkerAgent('claude');
    for (const f of CLAUDE_PANE_FIXTURES) {
      const ev = agent.snapshot(f.pane);
      expect(ev.pane).toBe(f.pane);
      expect(typeof ev.tuiReady).toBe('boolean');
      expect(typeof ev.activelyWorking).toBe('boolean');
      expect(typeof ev.permission.isPermission).toBe('boolean');
    }
  });

  it('events() streams a normalized snapshot per poll, honoring maxPolls + done()', async () => {
    const agent = resolveWorkerAgent('claude');
    const panes = CLAUDE_PANE_FIXTURES.map((f) => f.pane);
    let i = 0;
    const source = { capture: () => panes[Math.min(i++, panes.length - 1)] };
    const events = [];
    for await (const ev of agent.events(source, { intervalMs: 0, maxPolls: panes.length })) {
      events.push(ev);
    }
    expect(events.length).toBe(panes.length);
    // The first fixture pane is the "working" pane → activelyWorking true.
    expect(events[0].activelyWorking).toBe(true);
    expect(events[0].pane).toBe(panes[0]);

    // done() ends the stream after the current poll.
    let polls = 0;
    const stopping = { capture: () => { polls++; return ''; }, done: () => polls >= 2 };
    const collected = [];
    for await (const ev of agent.events(stopping, { intervalMs: 0 })) collected.push(ev);
    expect(collected.length).toBe(2);
  });

  it('resolveWorkerAgent throws for an unregistered provider', () => {
    // @ts-expect-error — exercising the runtime guard with an invalid id.
    expect(() => resolveWorkerAgent('gpt')).toThrow();
  });
});

describe('completion-resolver (ride-along)', () => {
  const proj = '/p';
  const id = 't1';

  it('passes a worker-declared rejected through untouched (no re-verify)', async () => {
    let gateCalls = 0;
    const res = await resolveCompletion(
      { runGate: async () => { gateCalls++; return { passed: true, reasons: [] }; } },
      proj, id, 'rejected',
    );
    expect(res.effective).toBe('rejected');
    expect(gateCalls).toBe(0);
  });

  it('overrides accepted → rejected on a failing gate (fail-closed)', async () => {
    const res = await resolveCompletion(
      { runGate: async () => ({ passed: false, reasons: ['tsc'] }) },
      proj, id, 'accepted',
    );
    expect(res.effective).toBe('rejected');
    expect(res.gateOverride?.passed).toBe(false);
  });

  it('a gate execution error fails CLOSED (rejected)', async () => {
    const res = await resolveCompletion(
      { runGate: async () => { throw new Error('boom'); } },
      proj, id, 'accepted',
    );
    expect(res.effective).toBe('rejected');
  });

  it('downgrades a gate-green-but-empty accepted → pending (hallucinated completion)', async () => {
    const res = await resolveCompletion(
      { runGate: async () => ({ passed: true, reasons: [] }), verifyWorkCommitted: async () => false },
      proj, id, 'accepted',
    );
    expect(res.effective).toBe('pending');
    expect(res.pendingReason).toMatch(/hallucinated/i);
  });

  it('keeps accepted when work IS committed', async () => {
    const res = await resolveCompletion(
      { runGate: async () => ({ passed: true, reasons: [] }), verifyWorkCommitted: async () => true },
      proj, id, 'accepted',
    );
    expect(res.effective).toBe('accepted');
  });

  it('re-verify failing OPEN (null/throw) preserves accepted — never false-downgrade', async () => {
    const resNull = await resolveCompletion(
      { runGate: async () => null, verifyWorkCommitted: async () => null },
      proj, id, 'accepted',
    );
    expect(resNull.effective).toBe('accepted');
    const resThrow = await resolveCompletion(
      { verifyWorkCommitted: async () => { throw new Error('probe down'); } },
      proj, id, 'accepted',
    );
    expect(resThrow.effective).toBe('accepted');
  });

  it('no gate + no re-verify preserves the worker self-report', async () => {
    const res = await resolveCompletion({}, proj, id, 'accepted');
    expect(res.effective).toBe('accepted');
  });
});
