/**
 * Operator-gated card TTL floor (feat-operator-card-ttl-floor).
 *
 * Operator-gated cards (irreversible/outward action gates) that supply no explicit
 * timeout are stamped with a 6-hour minimum TTL to ensure the operator sees them.
 * This prevents over-budget re-bet cards from being reaped inside the ~60s reconcile
 * window before the operator has a chance to decide.
 *
 * Mirrors the card-timeout-honesty.test.ts harness: isolates the global supervisor.db
 * via MERMAID_SUPERVISOR_DIR and the per-project todo DB via a temp dir.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supDir = mkdtempSync(join(tmpdir(), 'octf-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { runReconcilePass } from '../reconcile-pass';
import {
  createEscalation,
  getEscalation,
  listOpenEscalations,
  OPERATOR_CARD_MIN_TTL_MS,
  _closeDb,
} from '../supervisor-store';

const todoBase = mkdtempSync(join(tmpdir(), 'octf-todos-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeDb(); });
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
});
afterAll(() => {
  _closeDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

/** Run the reconcile pass with Date.now shifted forward by `deltaMs`. */
async function runPassAt(project: string, deltaMs: number): Promise<void> {
  const realNow = Date.now;
  const base = realNow();
  Date.now = () => base + deltaMs;
  try {
    await runReconcilePass(project);
  } finally {
    Date.now = realNow;
  }
}

describe('operator-gated cards — TTL floor', () => {
  it('stamps a six-hour expiry floor on an operator-gated card that supplies none', () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's1',
      kind: 'decision',
      audience: 'human',
      operatorGated: true,
      questionText: 'operator, you must decide this',
      // Note: no timeoutMs supplied
    });
    expect(escalation.expiresAt).not.toBeNull();
    expect(escalation.expiresAt! - escalation.createdAt).toBe(OPERATOR_CARD_MIN_TTL_MS);
    const reread = getEscalation(escalation.id);
    expect(reread?.expiresAt).not.toBeNull();
    expect(reread?.expiresAt! - reread?.createdAt!).toBe(OPERATOR_CARD_MIN_TTL_MS);
  });

  it('honours an explicit timeoutMs on an operator-gated card without raising it to the floor', () => {
    const project = freshProject();
    const shortTimeout = 5 * 60 * 1000; // 5 minutes, shorter than the 6-hour floor
    const { escalation } = createEscalation({
      project,
      session: 's2',
      kind: 'decision',
      audience: 'human',
      operatorGated: true,
      questionText: 'operator, decide quickly',
      timeoutMs: shortTimeout,
    });
    // The explicit timeout is honoured verbatim, even though it's shorter than the floor.
    expect(escalation.expiresAt).toBe(escalation.createdAt + shortTimeout);
    const reread = getEscalation(escalation.id);
    expect(reread?.expiresAt).toBe(escalation.createdAt + shortTimeout);
  });

  it('retains an operator-gated card when swept five minutes after creation', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's3',
      kind: 'decision',
      audience: 'human',
      operatorGated: true,
      questionText: 'operator, you must decide this',
      // Note: no timeoutMs supplied, so it floors to OPERATOR_CARD_MIN_TTL_MS
    });

    // Sweep at +5 minutes; the card should still be open
    await runPassAt(project, 5 * 60 * 1000);
    expect(listOpenEscalations().map(e => e.id)).toContain(escalation.id);
    const reopened = getEscalation(escalation.id);
    expect(reopened?.status).toBe('open');
  });

  it('reaps an operator-gated card when swept past its expiresAt', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's4',
      kind: 'decision',
      audience: 'human',
      operatorGated: true,
      questionText: 'operator, you must decide this',
      // Note: no timeoutMs supplied, so it floors to OPERATOR_CARD_MIN_TTL_MS
    });

    // Sweep at +6 hours + 1 minute; the card should be reaped with timeout-default reason
    await runPassAt(project, OPERATOR_CARD_MIN_TTL_MS + 60_000);
    expect(listOpenEscalations().map(e => e.id)).not.toContain(escalation.id);
    const reaped = getEscalation(escalation.id);
    expect(reaped?.status).toBe('stale');
    expect(reaped?.resolvedBy).toBe('timeout-default');
    expect(reaped?.resolutionNote).toContain('timeout-default: human never answered within');
  });

  it('stamps the six-hour floor on a human-audience card that is not operator-gated', () => {
    const project = freshProject();
    // This is the direct GAP-1 regression test: a human-audience card without operatorGated flag
    const { escalation } = createEscalation({
      project,
      session: 's5',
      kind: 'blocker',
      audience: 'human',
      // Note: operatorGated is omitted (defaults to false)
      questionText: 'human, you should know about this',
      // Note: no timeoutMs supplied
    });

    // The floor should apply to human-audience cards even without operatorGated=true
    expect(escalation.expiresAt).not.toBeNull();
    expect(escalation.expiresAt! - escalation.createdAt).toBe(OPERATOR_CARD_MIN_TTL_MS);

    // Re-read to confirm the floor is persisted
    const reread = getEscalation(escalation.id);
    expect(reread?.expiresAt).not.toBeNull();
    expect(reread?.expiresAt! - reread?.createdAt!).toBe(OPERATOR_CARD_MIN_TTL_MS);

    // Verify that internal-audience cards still get null expiresAt (legacy behavior)
    const internalCard = createEscalation({
      project,
      session: 's6',
      kind: 'blocker',
      audience: 'internal',
      questionText: 'internal daemon self-talk',
      // Note: no timeoutMs supplied
    });
    expect(internalCard.escalation.expiresAt).toBeNull();
  });
});
