import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'escalation-decide-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  getEscalation,
  getEscalationDecision,
  _closeDb,
} from '../supervisor-store.ts';
import { decideEscalation } from '../escalation-decide.ts';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

const OPTIONS = [
  { id: 'a', label: 'Approach A', detail: 'simpler' },
  { id: 'b', label: 'Approach B', detail: 'faster' },
];

describe('decideEscalation', () => {
  it('refuses an unoffered optionId and leaves the escalation open with no decision recorded', () => {
    const { escalation } = createEscalation({
      audience: 'internal',
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A or B?',
      options: OPTIONS,
      recommended: 'a',
    });

    const result = decideEscalation(escalation.id, { optionId: 'zzz' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('invalid-option');

    // Escalation should still be open
    const refreshed = getEscalation(escalation.id);
    expect(refreshed?.status).toBe('open');

    // No decision recorded
    const decision = getEscalationDecision(escalation.id);
    expect(decision).toBeNull();
  });

  it('records a valid option decision and flips status to decided', () => {
    const { escalation } = createEscalation({
      audience: 'internal',
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A or B?',
      options: OPTIONS,
      recommended: 'a',
    });

    const result = decideEscalation(escalation.id, { optionId: 'a' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.decision.optionId).toBe('a');
    expect(result.escalation.id).toBe(escalation.id);

    // Decision recorded
    const decision = getEscalationDecision(escalation.id);
    expect(decision?.optionId).toBe('a');

    // Escalation status flipped
    const refreshed = getEscalation(escalation.id);
    expect(refreshed?.status).toBe('decided');
  });

  it('records the decision under the full id when answered with a short id', () => {
    const { escalation } = createEscalation({
      audience: 'internal',
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A or B?',
      options: OPTIONS,
      recommended: 'a',
    });

    // Take the first 8 chars as a short id
    const shortId = escalation.id.substring(0, 8);

    const result = decideEscalation(shortId, { optionId: 'a' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    // Decision is recorded under the FULL id (what's in the store)
    const decision = getEscalationDecision(escalation.id);
    expect(decision).not.toBeNull();
    expect(decision?.optionId).toBe('a');

    // The returned escalation is the full one
    expect(result.escalation.id).toBe(escalation.id);
  });
});
