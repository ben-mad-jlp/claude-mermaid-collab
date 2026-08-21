// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Clear path for the verify-owed-backstop card: resolveVerifyOwedBackstopCards resolves an
// open verify-owed-backstop card scoped to a mission once nothing is owed and at least one
// criterion is verified. It matches the mission-scoped conditionKey PREFIX
// (`verify-owed:<missionId>:`), never a rebuilt hash — the owed SET that produced the raise
// key may no longer exist once everything clears. Harness mirrors
// conductor-verify-owed-arm.test.ts (temp MERMAID_SUPERVISOR_DIR set BEFORE the store import,
// _closeDb() in beforeEach).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolation: point the global supervisor.db at a temp dir BEFORE the store opens it.
const supDir = mkdtempSync(join(tmpdir(), 'vowed-resolve-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { listEscalations, createEscalation, _closeDb } from '../supervisor-store';
import { verifyOwedConditionKey } from '../mission-stall-predicate';
import { VERIFY_OWED_BACKSTOP_KIND } from '../conductor-verify-owed-arm';
import { resolveVerifyOwedBackstopCards } from '../conductor-pass';

const projBase = mkdtempSync(join(tmpdir(), 'vowed-resolve-proj-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(projBase, `proj-${++projectCounter}`);
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
  rmSync(projBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

function rowsFor(project: string) {
  return listEscalations().filter((e) => e.project === project);
}

const MISSION_ID = 'm1a2b3c4';
const SESSION = 'session-test';
const THRESHOLD_MS = 60_000;
const NOW = 1_000_000;

function verifiedCriterion(id: string) {
  return {
    id,
    met: true,
    verifiedAt: NOW - THRESHOLD_MS,
    action: 'discover',
    servingEpicState: 'landed' as const,
    servingEpicLandedAt: null,
    servingWorkCompletedAt: null,
  };
}

function owedCriterion(id: string) {
  return {
    id,
    met: false,
    verifiedAt: null,
    action: 'verify',
    servingEpicState: 'landed' as const,
    servingEpicLandedAt: NOW - THRESHOLD_MS * 2,
    servingWorkCompletedAt: null,
  };
}

function seedCard(project: string, criterionIds: string[]) {
  const conditionKey = verifyOwedConditionKey(MISSION_ID, criterionIds);
  createEscalation({
    project,
    session: SESSION,
    kind: VERIFY_OWED_BACKSTOP_KIND,
    todoId: MISSION_ID,
    operatorGated: true,
    audience: 'human',
    conditionKey,
    conditionTuple: ['verify-owed', MISSION_ID, ...criterionIds],
    questionText: `Mission "${MISSION_ID}" has ${criterionIds.length} criterion(criteria) owed a verify.`,
  });
  return conditionKey;
}

describe('resolveVerifyOwedBackstopCards', () => {
  it('resolves the open verify-owed card when nothing is owed and a criterion is verified', () => {
    const project = freshProject();
    const conditionKey = seedCard(project, ['c1']);

    const result = resolveVerifyOwedBackstopCards(project, MISSION_ID, {
      listCriteriaWithActions: (() => [verifiedCriterion('c1')]) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(result.owed).toEqual([]);
    expect(result.verified).toEqual(['c1']);
    expect(result.resolved.length).toBe(1);

    const openRows = rowsFor(project).filter((e) => e.conditionKey === conditionKey && e.status === 'open');
    expect(openRows.length).toBe(0);

    const resolvedRow = rowsFor(project).find((e) => e.conditionKey === conditionKey);
    expect(resolvedRow).toBeDefined();
    expect(resolvedRow!.status).toBe('resolved');
    expect(resolvedRow!.resolutionNote ?? '').toContain('c1');
  });

  it('resolves nothing while any criterion is still owed', () => {
    const project = freshProject();
    const conditionKey = seedCard(project, ['c1', 'c2']);

    const result = resolveVerifyOwedBackstopCards(project, MISSION_ID, {
      listCriteriaWithActions: (() => [verifiedCriterion('c1'), owedCriterion('c2')]) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(result.owed).toEqual(['c2']);
    expect(result.resolved).toEqual([]);

    const openRows = rowsFor(project).filter((e) => e.conditionKey === conditionKey && e.status === 'open');
    expect(openRows.length).toBe(1);
  });

  it('matches the mission-scoped conditionKey prefix, not a rebuilt hash', () => {
    const project = freshProject();
    // Seeded card's key hashes a DIFFERENT id set than the now-verified one.
    const conditionKey = seedCard(project, ['stale-c9']);

    const result = resolveVerifyOwedBackstopCards(project, MISSION_ID, {
      listCriteriaWithActions: (() => [verifiedCriterion('c1')]) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(result.resolved.length).toBe(1);
    const openRows = rowsFor(project).filter((e) => e.conditionKey === conditionKey && e.status === 'open');
    expect(openRows.length).toBe(0);
  });

  it('fails open when the criteria read throws', () => {
    const project = freshProject();
    seedCard(project, ['c1']);

    const result = resolveVerifyOwedBackstopCards(project, MISSION_ID, {
      listCriteriaWithActions: (() => { throw new Error('store fault'); }) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(result).toEqual({ resolved: [], verified: [], owed: [] });
  });
});
