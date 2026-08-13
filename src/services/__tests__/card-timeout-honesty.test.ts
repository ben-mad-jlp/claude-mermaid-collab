/**
 * Timeout honesty for escalation cards (feat-card-timeout-honesty).
 *
 * Three defects, one lifecycle:
 *   1. Cards that PRINT a timeout ("Timeout: 10 minutes") were reaped by the
 *      reconcile stale sweep after ~60s — the human tie-breaker did not exist.
 *      Now: expiresAt is stamped at create (createdAt + timeoutMs) and the sweep
 *      MUST NOT touch a card whose expiresAt is in the future.
 *   2. A timeout fallthrough was recorded indistinguishably from a real decision.
 *      Now: resolvedBy='timeout-default' + a fixed resolutionNote marker.
 *   3. No trace when a human call was overridden by silence. Now: the marker note
 *      is durable and sticky (a later mechanical 'ai' resolve cannot relabel it).
 *
 * Mirrors the reconcile-pass.test.ts harness: isolates the global supervisor.db
 * via MERMAID_SUPERVISOR_DIR and the per-project todo DB via a temp dir.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supDir = mkdtempSync(join(tmpdir(), 'cth-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { runReconcilePass } from '../reconcile-pass';
import {
  createEscalation,
  getEscalation,
  resolveEscalation,
  listOpenEscalations,
  SUPERVISOR_STALE_AFTER_MS,
  _closeDb,
} from '../supervisor-store';
import { awaitContestedDecision, awaitSplitDecision, proposeContested, SPLIT_PROPOSAL_TIMEOUT_MS } from '../split-proposal';
import { EPIC_LAND_CARD_TIMEOUT_MS } from '../coordinator-land';

const todoBase = mkdtempSync(join(tmpdir(), 'cth-todos-'));
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

describe('createEscalation — expiresAt stamped from timeoutMs', () => {
  it('stamps expiresAt = createdAt + timeoutMs and a re-read confirms it', () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's1',
      kind: 'decision',
      audience: 'human',
      questionText: 'stamped?',
      timeoutMs: 10 * 60 * 1000,
    });
    expect(escalation.expiresAt).toBe(escalation.createdAt + 10 * 60 * 1000);
    const reread = getEscalation(escalation.id);
    expect(reread?.expiresAt).toBe(escalation.createdAt + 10 * 60 * 1000);
  });

  it('leaves expiresAt NULL when no timeoutMs is passed', () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's1',
      kind: 'blocker',
      audience: 'human',
      questionText: 'no promise',
    });
    expect(escalation.expiresAt).toBeNull();
    expect(getEscalation(escalation.id)?.expiresAt).toBeNull();
  });

  it('a keyed recurrence re-raise refreshes expiresAt from the latest raise', () => {
    const project = freshProject();
    const mk = () => createEscalation({
      project,
      session: 's1',
      kind: 'epic-ready-to-land',
      audience: 'human',
      questionText: 'land?',
      conditionKey: 'epic-ready-to-land:abcd1234',
      conditionTuple: ['abcd1234', 'branch', 'green'],
      timeoutMs: EPIC_LAND_CARD_TIMEOUT_MS,
    });
    const first = mk();
    expect(first.isNew).toBe(true);
    const firstExpiry = first.escalation.expiresAt!;
    const second = mk();
    expect(second.isNew).toBe(false);
    expect(second.escalation.id).toBe(first.escalation.id);
    // Refreshed: the new deadline is >= the original (re-promised from the re-raise).
    expect(second.escalation.expiresAt!).toBeGreaterThanOrEqual(firstExpiry);
  });
});

describe('reconcile sweep — honors a printed timeout (the current-bug pin)', () => {
  it('a card promising 10 minutes SURVIVES the sweep at +60s, then reaps after expiry as timeout-default', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 'contested-1',
      kind: 'decision',
      audience: 'human',
      questionText: '[CONTESTED REVIEW] survives?',
      recommended: null,
      timeoutMs: SPLIT_PROPOSAL_TIMEOUT_MS, // the card prints "Timeout: 10 minutes"
    });

    // +60s — the old bug reaped it here. It must survive.
    await runPassAt(project, 60_000);
    expect(listOpenEscalations().map((e) => e.id)).toContain(escalation.id);

    // +11 minutes — the promise expired; now it is reapable, labeled honestly.
    await runPassAt(project, 11 * 60 * 1000);
    const closed = getEscalation(escalation.id);
    expect(closed?.status).toBe('stale');
    expect(closed?.resolvedBy).toBe('timeout-default');
    expect(closed?.resolutionNote).toContain('timeout-default: human never answered within');
  });

  it('a card with NULL expiresAt keeps today\'s sweep behavior (stale after the window, resolvedBy=ai)', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 'legacy-1',
      kind: 'blocker',
      audience: 'internal',
      questionText: 'legacy stale behavior',
    });

    // Younger than the stale window: untouched.
    await runPassAt(project, 1_000);
    expect(listOpenEscalations().map((e) => e.id)).toContain(escalation.id);

    // Older than the stale window: closed exactly as before.
    await runPassAt(project, SUPERVISOR_STALE_AFTER_MS + 60_000);
    const closed = getEscalation(escalation.id);
    expect(closed?.status).toBe('stale');
    expect(closed?.resolvedBy).toBe('ai');
    expect(closed?.resolutionNote).toBeNull();
  });
});

describe('timeout fallthrough — labeled, never recorded as a decision', () => {
  it('awaitContestedDecision timeout stamps resolvedBy=timeout-default + the marker note', async () => {
    const project = freshProject();
    const card = proposeContested({
      project,
      session: 's1',
      leaf: { id: 'leaf-1', title: 'contested leaf' },
      reason: 'uncovered contested review',
    });
    const answer = await awaitContestedDecision({
      escalationId: card.escalationId,
      createdAt: card.createdAt,
      timeoutMs: 1_000,
      now: () => card.createdAt + 2_000, // already past the deadline
      readDecision: () => null, // nobody ever answered
    });
    expect(answer).toBe('timeout');
    const esc = getEscalation(card.escalationId);
    expect(esc?.resolvedBy).toBe('timeout-default');
    expect(esc?.resolutionNote).toContain('timeout-default: human never answered within');
    expect(esc?.resolutionNote).toContain('defaulted to reject');
  });

  it('the timeout-default label is STICKY against the executor\'s later mechanical ai resolve', async () => {
    const project = freshProject();
    const card = proposeContested({
      project,
      session: 's2',
      leaf: { id: 'leaf-2', title: 'contested leaf 2' },
      reason: 'uncovered contested review',
    });
    await awaitContestedDecision({
      escalationId: card.escalationId,
      createdAt: card.createdAt,
      timeoutMs: 1_000,
      now: () => card.createdAt + 2_000,
      readDecision: () => null,
    });
    // leaf-executor's follow-up: resolveProposal(card.escalationId, 'resolved', 'ai')
    resolveEscalation(card.escalationId, 'resolved', 'ai');
    const esc = getEscalation(card.escalationId);
    expect(esc?.resolvedBy).toBe('timeout-default');
    expect(esc?.resolutionNote).toContain('timeout-default:');
  });

  it('awaitSplitDecision timeout stamps timeout-default with the linear default named', async () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's3',
      kind: 'decision',
      audience: 'human',
      questionText: '[SPLIT PROPOSAL] split?',
      timeoutMs: SPLIT_PROPOSAL_TIMEOUT_MS,
    });
    const answer = await awaitSplitDecision({
      escalationId: escalation.id,
      createdAt: escalation.createdAt,
      timeoutMs: 1_000,
      now: () => escalation.createdAt + 2_000,
      readDecision: () => null,
    });
    expect(answer).toBe('timeout');
    const esc = getEscalation(escalation.id);
    expect(esc?.resolvedBy).toBe('timeout-default');
    expect(esc?.resolutionNote).toContain('defaulted to linear');
  });

  it('a real human resolution still records resolvedBy=human', () => {
    const project = freshProject();
    const { escalation } = createEscalation({
      project,
      session: 's4',
      kind: 'decision',
      audience: 'human',
      questionText: 'human answers this one',
      timeoutMs: SPLIT_PROPOSAL_TIMEOUT_MS,
    });
    resolveEscalation(escalation.id, 'resolved', 'human');
    const esc = getEscalation(escalation.id);
    expect(esc?.resolvedBy).toBe('human');
    expect(esc?.resolutionNote).toBeNull();
  });
});
