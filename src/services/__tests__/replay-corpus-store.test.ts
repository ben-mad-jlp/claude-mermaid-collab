// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordGateEval,
  listGateEvals,
  setOverride,
  _closeProject,
  _openDbForTest,
} from '../replay-corpus-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'replay-'));
});

afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('replay-corpus-store', () => {
  it('inserts two rows with distinct leafIds and returns them newest-first', async () => {
    const eval1 = await recordGateEval(project, {
      leafId: 'leaf-1',
      gate: 'g3',
      inputText: 'input1',
      changeSet: ['a.ts', 'b.ts'],
      verdict: 'accept',
      reasons: 'looks good',
    });

    const eval2 = await recordGateEval(project, {
      leafId: 'leaf-2',
      gate: 'citability',
      inputText: 'input2',
      changeSet: ['c.ts', 'd.ts'],
      verdict: 'park',
      reasons: 'needs review',
    });

    const evals = listGateEvals(project);
    expect(evals.length).toBe(2);
    // newest-first: eval2 was inserted last, so it should come first
    expect(evals[0].id).toBe(eval2.id);
    expect(evals[1].id).toBe(eval1.id);
  });

  it('roundtrips changeSet as an array via JSON serialization', async () => {
    const changeSet = ['src/main.ts', 'src/utils.ts', 'src/types.ts'];
    const eval1 = await recordGateEval(project, {
      leafId: 'leaf-1',
      gate: 'g3',
      inputText: 'input',
      changeSet,
      verdict: 'accept',
      reasons: 'ok',
    });

    expect(Array.isArray(eval1.changeSet)).toBe(true);
    expect(eval1.changeSet).toEqual(changeSet);

    const evals = listGateEvals(project);
    expect(Array.isArray(evals[0].changeSet)).toBe(true);
    expect(evals[0].changeSet).toEqual(changeSet);
  });

  it('setOverride mutates only the matching leafId and leaves others null', async () => {
    await recordGateEval(project, {
      leafId: 'leaf-1',
      gate: 'g3',
      inputText: 'input1',
      changeSet: ['a.ts'],
      verdict: 'accept',
      reasons: 'ok',
    });

    const eval2 = await recordGateEval(project, {
      leafId: 'leaf-2',
      gate: 'citability',
      inputText: 'input2',
      changeSet: ['b.ts'],
      verdict: 'park',
      reasons: 'review',
    });

    await setOverride(project, 'leaf-1', 'accepted');

    const evals = listGateEvals(project);
    // Find the eval for leaf-1 (it should be the second in newest-first order)
    const leaf1Eval = evals.find((e) => e.leafId === 'leaf-1');
    const leaf2Eval = evals.find((e) => e.leafId === 'leaf-2');

    expect(leaf1Eval?.override).toBe('accepted');
    expect(leaf2Eval?.override).toBeNull();
  });

  it('_openDbForTest cache identity: same handle on second call', () => {
    const db1 = _openDbForTest(project);
    const db2 = _openDbForTest(project);
    expect(db1).toBe(db2);
  });
});
