// Runs via `bun test` (uses node:fs tmp dirs + an isolated supervisor.db) —
// excluded from vitest. Covers the COORD watchdog↔supervisor decision handoff:
// the durable decision queue (enqueue/dedupe/resolve/consume), epoch-gated resolve,
// and the daemon's pure act-on-verdict policy + drain.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

// Each test gets a fresh isolated supervisor.db via MERMAID_SUPERVISOR_DIR.
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'supdec-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  const store = await import('../supervisor-store');
  store._closeDb();
});
afterEach(async () => {
  const store = await import('../supervisor-store');
  store._closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/repo/x';
const SESSION = 'worker-abc';

async function store() {
  return import('../supervisor-store');
}

describe('decision queue — enqueue + dedupe', () => {
  it('enqueues a pending request and returns it via getNextPendingDecision', async () => {
    const s = await store();
    const { decision, isNew } = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'idle 5m', sigHash: 'sig1' });
    expect(isNew).toBe(true);
    expect(decision.status).toBe('pending');
    const next = s.getNextPendingDecision(PROJECT);
    expect(next?.id).toBe(decision.id);
  });

  it('DEDUPES repeat enqueues of the same episode by sigHash (one pending row)', async () => {
    const s = await store();
    const a = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'snap', sigHash: 'dup' });
    const b = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'snap again', sigHash: 'dup' });
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(b.decision.id).toBe(a.decision.id);
    expect(s.listPendingDecisions(PROJECT).length).toBe(1);
  });
});

describe('decision queue — epoch-gated resolve (2dd13c65)', () => {
  it('a superseded supervisor epoch is REJECTED and performs NO write', async () => {
    const s = await store();
    const { decision } = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'x', sigHash: 'e1' });
    s.setSupervisorIdentity(PROJECT, 'sup-A'); // epoch 1
    const epochB = s.setSupervisorIdentity(PROJECT, 'sup-B'); // epoch 2 (current)
    expect(epochB).toBe(2);
    // A (epoch 1) is now superseded → throws, no write.
    expect(() => s.resolveDecision({ id: decision.id, verdict: 'nudge', epoch: 1 })).toThrow(s.SupersededError);
    expect(s.getDecision(decision.id)?.status).toBe('pending');
    // B (epoch 2) succeeds.
    const resolved = s.resolveDecision({ id: decision.id, verdict: 'nudge', epoch: 2, reason: 'go' });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.verdict).toBe('nudge');
  });

  it('resolving a non-pending request is a no-op (returns null)', async () => {
    const s = await store();
    const { decision } = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'x', sigHash: 'e2' });
    s.setSupervisorIdentity(PROJECT, 'sup'); // epoch 1
    expect(s.resolveDecision({ id: decision.id, verdict: 'escalate', epoch: 1 })?.status).toBe('resolved');
    expect(s.resolveDecision({ id: decision.id, verdict: 'nudge', epoch: 1 })).toBeNull();
  });
});

describe('plannedActionForDecision — pure act policy', () => {
  it('resolved → act on the verdict', async () => {
    const { plannedActionForDecision } = await import('../coordinator-live');
    const r = plannedActionForDecision({ status: 'resolved', verdict: 'escalate', verdictReason: 'risky', createdAt: 0 }, 1000, 5000);
    expect(r).toEqual({ act: 'escalate', reason: 'risky' });
  });
  it('pending past the timeout → fail-safe escalate', async () => {
    const { plannedActionForDecision } = await import('../coordinator-live');
    const r = plannedActionForDecision({ status: 'pending', verdict: null, verdictReason: null, createdAt: 0 }, 6000, 5000);
    expect(r).toEqual({ act: 'escalate', reason: 'timeout' });
  });
  it('pending within the timeout → keep waiting (null)', async () => {
    const { plannedActionForDecision } = await import('../coordinator-live');
    expect(plannedActionForDecision({ status: 'pending', verdict: null, verdictReason: null, createdAt: 0 }, 1000, 5000)).toBeNull();
  });
});

describe('drainSupervisorDecisions — daemon acts deterministically', () => {
  it('verdict=escalate → escalate dep called; verdict=nudge → nudge dep called; both consumed', async () => {
    const s = await store();
    const { drainSupervisorDecisions } = await import('../coordinator-live');
    s.setSupervisorIdentity(PROJECT, 'sup'); // epoch 1
    const e = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'a', sigHash: 'd1' });
    const n = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'b', sigHash: 'd2' });
    s.resolveDecision({ id: e.decision.id, verdict: 'escalate', epoch: 1 });
    s.resolveDecision({ id: n.decision.id, verdict: 'nudge', epoch: 1 });
    const escalated: string[] = [];
    const nudged: string[] = [];
    const consumed = await drainSupervisorDecisions(PROJECT, {
      escalate: (d) => { escalated.push(d.id); },
      nudge: (d) => { nudged.push(d.id); return true; },
    }, 1000, 5000);
    expect(escalated).toEqual([e.decision.id]);
    expect(nudged).toEqual([n.decision.id]);
    expect(consumed.sort()).toEqual([e.decision.id, n.decision.id].sort());
    expect(s.getDecision(e.decision.id)?.status).toBe('consumed');
    expect(s.getDecision(n.decision.id)?.status).toBe('consumed');
  });

  it('timeout with NO verdict → default ESCALATE (fail-safe), consumed', async () => {
    const s = await store();
    const { drainSupervisorDecisions } = await import('../coordinator-live');
    const d = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'a', sigHash: 'to1' });
    const escalated: Array<{ id: string; reason: string }> = [];
    // now far beyond createdAt + timeout
    const consumed = await drainSupervisorDecisions(PROJECT, {
      escalate: (dec, reason) => { escalated.push({ id: dec.id, reason }); },
      nudge: () => true,
    }, d.decision.createdAt + 10_000, 5000);
    expect(escalated).toEqual([{ id: d.decision.id, reason: 'timeout' }]);
    expect(consumed).toEqual([d.decision.id]);
    expect(s.getDecision(d.decision.id)?.status).toBe('consumed');
  });

  it('verdict=wait → LEFT pending, not consumed, no dep called', async () => {
    const s = await store();
    const { drainSupervisorDecisions } = await import('../coordinator-live');
    s.setSupervisorIdentity(PROJECT, 'sup');
    const w = s.enqueueDecision({ project: PROJECT, workerSession: SESSION, signal: 'stall', snapshot: 'a', sigHash: 'w1' });
    s.resolveDecision({ id: w.decision.id, verdict: 'wait', epoch: 1 });
    let called = 0;
    const consumed = await drainSupervisorDecisions(PROJECT, {
      escalate: () => { called++; },
      nudge: () => { called++; return true; },
    }, 1000, 5000);
    expect(called).toBe(0);
    expect(consumed).toEqual([]);
    // resolved+wait stays resolved (acted-on-later is fine); never escalated/consumed here.
    expect(s.getDecision(w.decision.id)?.status).toBe('resolved');
  });
});
