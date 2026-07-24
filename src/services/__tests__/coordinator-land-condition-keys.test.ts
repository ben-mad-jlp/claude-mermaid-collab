// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Condition keys for the coordinator-land raise sites: the land escalations carry a durable
// `conditionKey`/`conditionTuple` so createEscalation's keyed dedup bumps an OPEN card
// instead of minting a rival, and keeps a RESOLVED card suppressed while the underlying
// failure CLASS is unchanged. Drives the DB-only surfaces directly — no git worktrees.
// Harness mirrors dep-strand-sweep.test.ts (temp MERMAID_SUPERVISOR_DIR set BEFORE the
// store import, _closeDb() in beforeEach).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolation: point the global supervisor.db at a temp dir BEFORE the store opens it.
const supDir = mkdtempSync(join(tmpdir(), 'clck-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { listEscalations, resolveEscalation, _closeDb } from '../supervisor-store';
import {
  surfaceStuckAutoLand,
  surfaceDirtyLandBlocker,
  landReasonClass,
  landCondition,
  type LandEpicOutcome,
} from '../coordinator-land';

const projBase = mkdtempSync(join(tmpdir(), 'clck-proj-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(projBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeDb(); });
beforeEach(() => {
  // Re-assert OUR supervisor dir + reopen the singleton (last loader wins the env when
  // several store-touching files share a process).
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
function rowsForKey(project: string, conditionKey: string) {
  return rowsFor(project).filter((e) => e.conditionKey === conditionKey);
}

const EPIC = 'a1b2c3d4-1111-2222-3333-444455556666';
const BRANCH = 'collab/epic-a1b2c3d4';

describe('coordinator-land condition keys', () => {
  it('re-raise of an unchanged failing epic yields ONE open card with recurrenceCount>0', () => {
    const project = freshProject();
    const ctx = { epicId: EPIC, epicBranch: BRANCH, reason: 'build-proof-red:gate-regression' };

    const first = surfaceStuckAutoLand(project, 'coordinator', ctx);
    expect(first.isNew).toBe(true);
    const second = surfaceStuckAutoLand(project, 'coordinator', ctx);
    expect(second.isNew).toBe(false);

    const key = landCondition('blocker', [EPIC.slice(0, 8), 'gate-regression']).conditionKey;
    expect(first.escalation.conditionKey).toBe(key);

    const rows = rowsForKey(project, key);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.recurrenceCount).toBeGreaterThan(0);
  });

  it('resolving then re-raising the same failure yields zero new rows', () => {
    const project = freshProject();
    const ctx = { epicId: EPIC, epicBranch: BRANCH, reason: 'build-proof-red:gate-regression' };

    const first = surfaceStuckAutoLand(project, 'coordinator', ctx);
    resolveEscalation(first.escalation.id, 'resolved', 'ai');
    const before = rowsFor(project).length;

    const again = surfaceStuckAutoLand(project, 'coordinator', ctx);
    expect(again.isNew).toBe(false);
    expect(again.escalation.id).toBe(first.escalation.id);
    expect(rowsFor(project).length).toBe(before);
  });

  it('changing the failure class yields exactly one new row', () => {
    const project = freshProject();
    const base = { epicId: EPIC, epicBranch: BRANCH };

    const first = surfaceStuckAutoLand(project, 'coordinator', { ...base, reason: 'build-proof-red:gate-regression' });
    resolveEscalation(first.escalation.id, 'resolved', 'ai');
    const before = rowsFor(project).length;

    // A DIFFERENT class ⇒ same key, different tuple ⇒ resolved-suppression misses.
    const changed = surfaceStuckAutoLand(project, 'coordinator', { ...base, reason: 'build-proof-red:tsc-failed' });
    expect(changed.isNew).toBe(true);
    expect(changed.escalation.id).not.toBe(first.escalation.id);
    expect(rowsFor(project).length).toBe(before + 1);
  });

  it('landReasonClass collapses composed prefixes', () => {
    expect(landReasonClass('build-proof-red:gate-regression')).toBe('gate-regression');
    expect(landReasonClass('stale-build-base:revalidation-gate-failed')).toBe('stale-base');
    expect(landReasonClass('stale-build-base:forward-integrate-conflict')).toBe('stale-base');
    expect(landReasonClass('tsc-failed')).toBe('tsc-red');
    expect(landReasonClass('land-deps-unsatisfied')).toBe('deps-open');
    expect(landReasonClass('land-not-ready')).toBe('not-ready');
    // No sha / path / raw error text ever survives into a class.
    expect(landReasonClass('boom: cannot read /tmp/x at abc1234')).toBe('other');
    expect(landReasonClass('')).toBe('other');
  });

  it('landCondition builds a stable key and a class-bearing tuple', () => {
    const a = landCondition('blocker', [EPIC.slice(0, 8), 'dirty-tree']);
    const b = landCondition('blocker', [EPIC.slice(0, 8), 'dirty-tree']);
    expect(a.conditionKey).toBe(b.conditionKey);
    expect(a.conditionKey).toBe(`blocker:${EPIC.slice(0, 8)}:dirty-tree`);
    expect(a.conditionTuple).toEqual(['blocker', EPIC.slice(0, 8), 'dirty-tree']);
  });

  it('a repeated dirty-tree land refusal collapses to one card', () => {
    const project = freshProject();
    const outcome: LandEpicOutcome = { ok: false, landed: false, reason: 'dirty-tree', dirtyPaths: ['src/a.ts'] };
    const ctx = { epicId: EPIC, epicBranch: BRANCH, todoId: null };

    const first = surfaceDirtyLandBlocker(project, 'coordinator', outcome, ctx);
    const second = surfaceDirtyLandBlocker(project, 'coordinator', outcome, ctx);
    expect(first?.isNew).toBe(true);
    expect(second?.isNew).toBe(false);

    const key = landCondition('blocker', [EPIC.slice(0, 8), 'dirty-tree']).conditionKey;
    const rows = rowsForKey(project, key);
    expect(rows.length).toBe(1);
    expect(rows[0]!.recurrenceCount).toBeGreaterThan(0);
  });
});
