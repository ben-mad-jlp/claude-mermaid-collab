// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
// Tests that setMissionClosed atomically stamps the mission's todo node with status='done'
// (or status='planned' on reopen) inside the same db transaction as the mission row updates.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, _closeProject, getTodo,
} from '../todo-store';
import {
  upsertMission, getMission, addCriterion, setMissionClosed,
  setCriterionMet, deactivateIfTerminal,
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeDb } from '../supervisor-store';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-close-stamps-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-close-stamps-todo-done: todo status atomicity', () => {
  test('deactivateIfTerminal on a converged mission leaves the mission todo status done', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'first criterion');

    // Before marking the criterion met, the mission is not terminal
    const missionBefore = getMission(project, id)!;
    expect(missionBefore.closedAt).toBeNull();
    const todoBefore = getTodo(project, id)!;
    expect(todoBefore.status).not.toBe('done');

    // Mark the criterion met (setCriterionMet calls deactivateIfTerminal internally)
    // This should both set mission.closedAt AND stamp the todo status='done'
    setCriterionMet(project, c1.id, true);

    // The todo must now have status='done'
    const todo = getTodo(project, id)!;
    expect(todo.status).toBe('done');
    expect(todo.completedAt).toBeTruthy();

    // The mission should also be closed
    const m = getMission(project, id)!;
    expect(m.closedAt).not.toBeNull();
  });

  test('dirty closure with an unmet criterion stamps the todo done and still writes closureEvidence', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'will be met');
    const c2 = addCriterion(project, id, 'will stay unmet');

    // Mark only the first criterion met, leaving the second unmet
    setCriterionMet(project, c1.id, true);

    // Verify the mission is not yet closed (only one criterion met out of two)
    const missionBefore = getMission(project, id)!;
    expect(missionBefore.closedAt).toBeNull();

    // Manually close with dirty (unmet) criteria
    const closeAtMs = Date.now();
    setMissionClosed(project, id, closeAtMs, { judge: 'test-judge' });

    // The mission should record the judge and evidence
    const m = getMission(project, id)!;
    expect(m.closedAt).toBe(closeAtMs);
    expect(m.closedBy).toBe('test-judge');
    expect(m.closureEvidence).toBeTruthy();

    // Parse and verify the evidence
    const evidence = JSON.parse(m.closureEvidence!);
    expect(evidence.unmetCriterionIds).toContain(c2.id);
    expect(evidence.judge).toBe('test-judge');

    // Most importantly: the todo must be stamped status='done'
    const todo = getTodo(project, id)!;
    expect(todo.status).toBe('done');
    expect(todo.completedAt).toBeTruthy();
  });

  test('reopen clears closedAt and takes the mission todo off done', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'first criterion');
    const c2 = addCriterion(project, id, 'second criterion');

    // Close the mission
    const closeAtMs = Date.now();
    setMissionClosed(project, id, closeAtMs, { judge: 'test-close' });

    // Verify it's closed and the todo is done
    let m = getMission(project, id)!;
    expect(m.closedAt).toBe(closeAtMs);
    let todo = getTodo(project, id)!;
    expect(todo.status).toBe('done');

    // Reopen by passing at=null
    setMissionClosed(project, id, null);

    // The mission must have closedAt cleared
    m = getMission(project, id)!;
    expect(m.closedAt).toBeNull();
    expect(m.closedBy).toBeNull();
    expect(m.closureEvidence).toBeNull();

    // The todo must be taken off 'done' status
    todo = getTodo(project, id)!;
    expect(todo.status).toBe('planned');
    // completedAt should be cleared on reopen
    expect(todo.completedAt).toBeNull();
  });
});
