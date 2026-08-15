// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// FIX: forgeMission validates ALL criteria before any write.
//
// Previously, forgeMission validated criteria only for forward-accrual (detectForwardAccrual)
// and forward-accrual overloading (toOneShot). Citability was checked per-criterion inside
// addCriterion, which runs AFTER addSessionTodo / upsertMission / stampMissionNodeApproved /
// enqueueMission. A criterion that failed citability therefore left a live mission node +
// mission row + any criteria that preceded the offender.
//
// The fix hoists the aggregate citability gate to BEFORE any write, so a mission with any
// uncitable criterion is refused atomically and without side effects.
//
// Two properties under test:
//   1. no write occurs when any criterion is uncitable — mission count and todo count stay
//      identical to the pre-forge state.
//   2. all uncitable criteria are named in a single refusal, so callers can fix them in one
//      round trip (not one-at-a-time).
//
// Hermetic: every test runs against a fresh mkdtemp project; no real .collab/*.db and no
// ~/.mermaid-collab access.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _closeProject, listTodos } from '../todo-store';
import { listMissions, _resetMissionDbCache, UncitableMissionCriteriaError } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'forge-mission-atomicity-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('forgeMission atomicity — validate all criteria before any write', () => {
  test('leaves the mission count identical when the second of three criteria is uncitable', async () => {
    // Snapshot the counts before forge
    const beforeMissionCount = listMissions(project, { withFacts: false, includeArchived: true }).length;
    const beforeTodoCount = listTodos(project, { includeCompleted: true }).length;

    // Attempt to forge with citable/uncitable/citable criteria
    const input = {
      session: 's1',
      title: 'Test mission',
      criteria: [
        'the first criterion is citable',
        'the full test suite passes and the build is green', // UNCITABLE: command result
        'the third criterion is also citable',
      ],
    };

    let err: unknown;
    try {
      await forgeMission(project, input);
    } catch (e) {
      err = e;
    }

    // Verify the error is thrown
    expect(err).toBeInstanceOf(UncitableMissionCriteriaError);

    // Verify the counts are unchanged (no writes occurred)
    const afterMissionCount = listMissions(project, { withFacts: false, includeArchived: true }).length;
    const afterTodoCount = listTodos(project, { includeCompleted: true }).length;

    expect(afterMissionCount).toBe(beforeMissionCount);
    expect(afterTodoCount).toBe(beforeTodoCount);
  });

  test('names all uncitable criteria in a single refusal', async () => {
    const input = {
      session: 's1',
      title: 'Test mission with multiple uncitable criteria',
      criteria: [
        'this criterion is citable',
        'the full test suite passes', // UNCITABLE: command result
        'another citable criterion here',
        'No new files are added under src/', // UNCITABLE: bare absence
      ],
    };

    let err: unknown;
    try {
      await forgeMission(project, input);
    } catch (e) {
      err = e;
    }

    // Verify exactly one error is thrown
    expect(err).toBeInstanceOf(UncitableMissionCriteriaError);
    const error = err as UncitableMissionCriteriaError;

    // Verify the error carries the offenders array
    expect(error.offenders).toBeDefined();
    expect(error.offenders).toHaveLength(2);

    // Verify both offending criteria are listed with correct indices
    const offendingIndices = error.offenders.map((o) => o.index).sort();
    expect(offendingIndices).toEqual([1, 3]); // second and fourth criteria (0-indexed)

    // Verify both offending texts appear in the message
    expect(error.message).toContain('the full test suite passes');
    expect(error.message).toContain('No new files are added under src/');

    // Verify the reasons are captured and contain guidance
    const offendersByIndex = new Map(error.offenders.map((o) => [o.index, o]));
    const secondCrit = offendersByIndex.get(1);
    const fourthCrit = offendersByIndex.get(3);

    expect(secondCrit?.reason).toContain('command');
    expect(fourthCrit?.reason).toContain('absence');
  });
});
