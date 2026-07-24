import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Isolate the global supervisor.db BEFORE the store module opens it (openDb memoises
// the handle — supervisor-store.ts:316).
const dir = mkdtempSync(join(tmpdir(), 'cond-keys-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { createEscalation, resolveEscalation, _closeDb } from '../supervisor-store';
import { coordinatorCondition, COORDINATOR_CONDITION_REASONS } from '../coordinator-condition-keys';

// Literal mirror of coordinator-live.ts's BP0_STRANDED_SUMMARY_KIND ('bp0-stranded-summary').
// Deliberately NOT importing coordinator-live.ts here — it drags in the full daemon graph,
// which is exactly what coordinator-condition-keys.ts was split out to avoid.
const BP0_STRANDED_SUMMARY_KIND = 'bp0-stranded-summary';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

/** One descriptor per coordinator-live.ts raise site (blueprint table). `kind` + `parts`
 *  are exactly what each site passes to `coordinatorCondition`. */
const DESCRIPTORS: { name: string; kind: string; parts: string[] }[] = [
  { name: 'daily-budget', kind: 'blocker', parts: [COORDINATOR_CONDITION_REASONS.dailyBudget, '/proj/daily-budget'] },
  { name: 'stranded-accept-reversed', kind: 'assumption-invalidated', parts: ['aaaaaaaa', 'eeeeeeee', COORDINATOR_CONDITION_REASONS.strandedAcceptReversed] },
  { name: 'parked-held-reopen-cap', kind: 'blocker', parts: ['bbbbbbbb', 'eeeeeeee', COORDINATOR_CONDITION_REASONS.parkedHeldReopenCap] },
  { name: 'redispatch-cap', kind: 'blocker', parts: ['cccccccc', COORDINATOR_CONDITION_REASONS.redispatchCap] },
  { name: 'bp1-stranded-foundation', kind: 'assumption-invalidated', parts: ['dddddddd', COORDINATOR_CONDITION_REASONS.bp1StrandedFoundation] },
  { name: 'bp0-stranded-summary', kind: BP0_STRANDED_SUMMARY_KIND, parts: ['/proj/bp0-summary'] },
  { name: 'merge-back-conflict', kind: 'assumption-invalidated', parts: ['ffffffff', 'eeeeeeee', COORDINATOR_CONDITION_REASONS.mergeBackConflict] },
  { name: 'merge-back-failed', kind: 'assumption-invalidated', parts: ['11111111', 'eeeeeeee', COORDINATOR_CONDITION_REASONS.mergeBackFailed] },
  { name: 'leaf-executor-error', kind: 'blocker', parts: ['22222222', COORDINATOR_CONDITION_REASONS.leafExecutorError] },
  { name: 'no-worker-lane', kind: 'blocker', parts: ['33333333', COORDINATOR_CONDITION_REASONS.noWorkerLane, 'epic-or-mission'] },
  { name: 'retry-exhausted', kind: 'blocker', parts: ['44444444', COORDINATOR_CONDITION_REASONS.retryExhausted] },
  { name: 'budget-hard-cap', kind: 'blocker', parts: ['55555555', COORDINATOR_CONDITION_REASONS.budgetHardCap] },
  { name: 'rate-cap-exhausted', kind: 'blocker', parts: ['66666666', COORDINATOR_CONDITION_REASONS.rateCapExhausted] },
  { name: 'gate-rejected', kind: 'blocker', parts: ['77777777', COORDINATOR_CONDITION_REASONS.gateRejected] },
];

const countRows = (project: string, conditionKey: string): number => {
  const dbPath = join(dir, 'supervisor.db');
  const directDb = new Database(dbPath);
  const rows = directDb.query('SELECT id FROM escalation WHERE project = ? AND conditionKey = ?').all(project, conditionKey) as { id: string }[];
  directDb.close();
  return rows.length;
};

describe('coordinatorCondition — 14 coordinator-live raise sites', () => {
  it('covers exactly the 14 blueprinted raise sites', () => {
    expect(DESCRIPTORS.length).toBe(14);
  });

  for (const d of DESCRIPTORS) {
    describe(d.name, () => {
      const project = `/test-cond/${d.name}`;
      const { conditionKey, conditionTuple } = coordinatorCondition(d.kind, ...d.parts);

      it('conditionKey/conditionTuple shape matches [kind, ...parts]', () => {
        expect(conditionKey).toBe([d.kind, ...d.parts].join(':'));
        expect(conditionTuple).toEqual([d.kind, ...d.parts]);
      });

      it('recurrence: raising twice with an unchanged subject updates one row', () => {
        const { escalation: esc1, isNew: isNew1 } = createEscalation({
          project, session: 'sess', kind: d.kind, questionText: 'first wording',
          conditionKey, conditionTuple,
        });
        expect(isNew1).toBe(true);
        expect(esc1.recurrenceCount).toBe(0);

        const { escalation: esc2, isNew: isNew2 } = createEscalation({
          project, session: 'sess', kind: d.kind, questionText: 'second wording (refreshed)',
          conditionKey, conditionTuple,
        });
        expect(isNew2).toBe(false);
        expect(esc2.id).toBe(esc1.id);
        expect(esc2.recurrenceCount).toBe(1);
        expect(esc2.questionText).toBe('second wording (refreshed)');
        expect(countRows(project, conditionKey)).toBe(1);
      });

      it('resolved-suppression: resolving then re-raising with an unchanged subject stays suppressed', () => {
        const { escalation: esc1 } = createEscalation({
          project: `${project}/resolve`, session: 'sess', kind: d.kind, questionText: 'wording',
          conditionKey, conditionTuple,
        });
        resolveEscalation(esc1.id, 'resolved');

        const { escalation: esc3, isNew: isNew3 } = createEscalation({
          project: `${project}/resolve`, session: 'sess', kind: d.kind, questionText: 'wording after resolve',
          conditionKey, conditionTuple,
        });
        expect(isNew3).toBe(false);
        expect(esc3.id).toBe(esc1.id);
        expect(esc3.status).toBe('resolved');
        expect(countRows(`${project}/resolve`, conditionKey)).toBe(1);
      });
    });
  }

  it('discrimination: different reason class or todoId8 yields a different conditionKey and a new row', () => {
    const project = '/test-cond/discriminate';
    const a = coordinatorCondition('blocker', 'aaaaaaaa', COORDINATOR_CONDITION_REASONS.retryExhausted);
    const b = coordinatorCondition('blocker', 'aaaaaaaa', COORDINATOR_CONDITION_REASONS.budgetHardCap);
    const c = coordinatorCondition('blocker', 'bbbbbbbb', COORDINATOR_CONDITION_REASONS.retryExhausted);

    expect(a.conditionKey).not.toBe(b.conditionKey);
    expect(a.conditionKey).not.toBe(c.conditionKey);

    const { escalation: escA } = createEscalation({
      project, session: 'sess', kind: 'blocker', questionText: 'a',
      conditionKey: a.conditionKey, conditionTuple: a.conditionTuple,
    });
    const { escalation: escB, isNew: isNewB } = createEscalation({
      project, session: 'sess', kind: 'blocker', questionText: 'b',
      conditionKey: b.conditionKey, conditionTuple: b.conditionTuple,
    });

    expect(isNewB).toBe(true);
    expect(escB.id).not.toBe(escA.id);
    expect(countRows(project, a.conditionKey)).toBe(1);
    expect(countRows(project, b.conditionKey)).toBe(1);
  });
});
