import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'decision-relay-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  recordEscalationDecision,
  getEscalationDecision,
  getEscalation,
  listOpenEscalations,
  _closeDb,
} from '../supervisor-store.ts';
import { awaitHumanDecision } from '../decision-relay.ts';
import { handleSupervisorRoutes } from '../../routes/supervisor-routes.ts';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

const OPTIONS = [
  { id: 'a', label: 'Approach A', detail: 'simpler' },
  { id: 'b', label: 'Approach B', detail: 'faster' },
];

describe('escalation decision store', () => {
  it('records and reads back a decision (upsert by escalationId)', () => {
    recordEscalationDecision({ escalationId: 'E1', optionId: 'a', note: 'go simple', decidedBy: 'human' });
    const d = getEscalationDecision('E1');
    expect(d?.optionId).toBe('a');
    expect(d?.note).toBe('go simple');
    // upsert: a second record overwrites
    recordEscalationDecision({ escalationId: 'E1', optionId: 'b' });
    expect(getEscalationDecision('E1')?.optionId).toBe('b');
  });
  it('getEscalationDecision returns null when none posted', () => {
    expect(getEscalationDecision('never')).toBeNull();
  });
});

describe('awaitHumanDecision', () => {
  it('returns immediately when a decision already exists', async () => {
    recordEscalationDecision({ escalationId: 'E2', optionId: 'a' });
    const r = await awaitHumanDecision('E2', { timeoutMs: 1000, pollMs: 10 });
    expect(r.decided).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.optionId).toBe('a');
  });

  it('times out with an injected clock (no real waiting)', async () => {
    let t = 0;
    const r = await awaitHumanDecision('E-none', {
      timeoutMs: 100,
      pollMs: 10,
      now: () => t,
      sleep: async (ms) => { t += ms; },
    });
    expect(r.timedOut).toBe(true);
    expect(r.decided).toBe(false);
    expect(r.optionId).toBeNull();
  });

  it('resolves when a decision is posted while awaiting (the relay)', async () => {
    const awaiting = awaitHumanDecision('E3', { timeoutMs: 5000, pollMs: 5 });
    const timer = setTimeout(() => recordEscalationDecision({ escalationId: 'E3', optionId: 'b', note: 'ship it' }), 20);
    (timer as { unref?: () => void }).unref?.();
    const r = await awaiting;
    expect(r.decided).toBe(true);
    expect(r.optionId).toBe('b');
    expect(r.note).toBe('ship it');
  });
});

async function decide(id: string, body: unknown): Promise<Response> {
  const req = new Request(`http://x/api/supervisor/escalation/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  if (!res) throw new Error('route not matched');
  return res;
}

describe('POST /api/supervisor/escalation/:id/decide', () => {
  it('end-to-end: worker awaits → POST decide → tool returns chosen id → escalation resolved', async () => {
    const { escalation } = createEscalation({ project: '/p', session: 's', kind: 'decision', questionText: 'A or B?', options: OPTIONS, recommended: 'a' });
    const awaiting = awaitHumanDecision(escalation.id, { timeoutMs: 5000, pollMs: 5 });
    const res = await decide(escalation.id, { optionId: 'b', note: 'faster wins' });
    expect(res.status).toBe(200);

    const r = await awaiting;
    expect(r.decided).toBe(true);
    expect(r.optionId).toBe('b');
    expect(r.note).toBe('faster wins');

    // escalation is now resolved (off the open inbox).
    expect(getEscalation(escalation.id)?.status).toBe('decided');
    expect(listOpenEscalations().some((e) => e.id === escalation.id)).toBe(false);
  });

  it('rejects an optionId that is not one of the escalation options (400)', async () => {
    const { escalation } = createEscalation({ project: '/p', session: 's', kind: 'decision', questionText: 'q', options: OPTIONS });
    const res = await decide(escalation.id, { optionId: 'zzz' });
    expect(res.status).toBe(400);
    // unchanged: still open, no decision recorded
    expect(getEscalation(escalation.id)?.status).toBe('open');
    expect(getEscalationDecision(escalation.id)).toBeNull();
  });

  it('requires optionId for a structured escalation (400)', async () => {
    const { escalation } = createEscalation({ project: '/p', session: 's', kind: 'decision', questionText: 'q2', options: OPTIONS });
    const res = await decide(escalation.id, { note: 'no option' });
    expect(res.status).toBe(400);
  });

  it('allows a note-only answer for a plain escalation (no options)', async () => {
    const { escalation } = createEscalation({ project: '/p', session: 's', kind: 'question', questionText: 'plain?' });
    const res = await decide(escalation.id, { note: 'do the thing' });
    expect(res.status).toBe(200);
    expect(getEscalationDecision(escalation.id)?.note).toBe('do the thing');
    expect(getEscalation(escalation.id)?.status).toBe('decided');
  });

  it('404 for an unknown escalation id', async () => {
    const res = await decide('nope', { optionId: 'a' });
    expect(res.status).toBe(404);
  });
});
