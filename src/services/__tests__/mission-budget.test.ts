// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject } from '../todo-store';
import { upsertMission, getMission, setMissionBudget, _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { recentAutonomousMutations, _resetAutonomyLog } from '../autonomy-log';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-budget-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _resetAutonomyLog();
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-store: setMissionBudget', () => {
  test('raise round-trip', async () => {
    const id = await makeMissionNode();
    const created = upsertMission(project, id, { budgetUsd: 5 });
    const before = getMission(project, id)!;
    const updated = setMissionBudget(project, id, 50, { actor: 'human' });
    expect(updated.budgetUsd).toBe(50);
    expect(getMission(project, id)!.budgetUsd).toBe(50);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(created.budgetUsd).toBe(5);
  });

  test('clear round-trip', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id, { budgetUsd: 5 });
    setMissionBudget(project, id, null, { actor: 'human' });
    expect(getMission(project, id)!.budgetUsd).toBeNull();
  });

  test('short-id resolution', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id, { budgetUsd: 5 });
    const shortId = id.slice(0, 8);
    const updated = setMissionBudget(project, shortId, 75, { actor: 'human' });
    expect(updated.todoId).toBe(id);
    expect(getMission(project, id)!.budgetUsd).toBe(75);
  });

  test('rejects invalid budgetUsd values', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id, { budgetUsd: 5 });
    for (const bad of [0, -1, NaN, Infinity, '20' as any]) {
      expect(() => setMissionBudget(project, id, bad, { actor: 'human' })).toThrow();
      expect(getMission(project, id)!.budgetUsd).toBe(5);
    }
  });

  test('rejects an empty actor', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id, { budgetUsd: 5 });
    expect(() => setMissionBudget(project, id, 10, { actor: '' })).toThrow(/non-empty actor/);
    expect(() => setMissionBudget(project, id, 10, {} as any)).toThrow(/non-empty actor/);
    expect(getMission(project, id)!.budgetUsd).toBe(5);
  });

  test('records exactly one budget-change audit entry per successful call', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id, { budgetUsd: 5 });
    setMissionBudget(project, id, 50, { actor: 'human', reason: 'raise for retries' });

    const entries = recentAutonomousMutations({ project }).filter((e) => e.kind === 'budget-change');
    expect(entries.length).toBe(1);
    expect(entries[0].actor).toBe('human');
    const detail = JSON.parse(entries[0].detail!);
    expect(detail.previousBudgetUsd).toBe(5);
    expect(detail.budgetUsd).toBe(50);
    expect(typeof detail.spendUsdAtChange).toBe('number');
  });

  test('unknown mission id throws mission not found', () => {
    expect(() => setMissionBudget(project, 'does-not-exist', 10, { actor: 'human' })).toThrow(/mission not found/);
  });
});
