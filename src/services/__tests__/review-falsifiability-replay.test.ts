/**
 * crit 5 (mission b86b383c) — MEASURED CALIBRATION. Seed the executor-core false-rejects from
 * mission c2d640ec (6619c55b, 0db337ab, 0351e1e4, 6d67a801 — each a correct, test-covered change
 * the daemon's review OVER-rejected with a non-falsifiable finding, later confirmed correct by a
 * hand-build) into the replay corpus as should-ACCEPT rows (setOverride), then REPLAY them
 * through the OLD AND-gate (a FAIL always rejects a green change) vs the NEW falsifiability gate
 * (crit 1: a non-falsifiable-doubt FAIL over a real change-set ACCEPTS). The new gate must drive
 * the false-reject count (fn = rejected should-accepts) to ZERO while the old gate has fn >= 4 —
 * the measured proof the mission removed the over-rejection.
 */
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { recordGateEval, setOverride, _closeProject } from '../replay-corpus-store';
import { replayCorpus, type CandidateGate } from '../gate-replay';
import { removeWatchedProject, _closeDb } from '../supervisor-store';
import { isNonFalsifiableReviewDoubt } from '../leaf-executor';

let projectDir: string;
let supDir: string;
let priorSupDir: string | undefined;

beforeEach(() => {
  priorSupDir = process.env.MERMAID_SUPERVISOR_DIR;
  supDir = mkdtempSync(`${tmpdir()}/gate-replay-supdir-`);
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
  projectDir = mkdtempSync(`${tmpdir()}/gate-replay-test-`);
});

afterEach(() => {
  _closeProject(projectDir);
  removeWatchedProject(projectDir);
  _closeDb();
  if (priorSupDir === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
  else process.env.MERMAID_SUPERVISOR_DIR = priorSupDir;
  try { rmSync(supDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// The four c2d640ec false-rejects: each a NON-falsifiable review FAIL ("can't confirm" /
// "nothing to review") over a REAL executor-core change-set — the exact over-rejection shape.
const CHANGE_SET = ['src/services/leaf-executor.ts'];
const FALSE_REJECTS = [
  { leafId: '6619c55b', inputText: '## CRITERIA\n- [N/A] optimistic merge before review\n\nVERDICT: FAIL — I cannot confirm the mutual-exclusivity of the optimistic path is correct' },
  { leafId: '0db337ab', inputText: 'VERDICT: FAIL — unable to verify the retry findings are not clobbered by the raw-review assignment' },
  { leafId: '0351e1e4', inputText: 'VERDICT: FAIL — can\'t be sure the node-start-failure generalization is correct without more context' },
  { leafId: '6d67a801', inputText: '## CRITERIA\n- [N/A] prose-gate retry wiring\n\nnothing concrete to review here\n\nVERDICT: FAIL' },
];
// A genuine fault control (should-REJECT): the new gate must NOT accept a concrete finding.
const REAL_FAULT = { leafId: 'control-fault', inputText: 'VERDICT: FAIL — missing null check at leaf-executor.ts:42 returns undefined for empty findings' };

// OLD gate: mech AND llm — a review FAIL always REJECTS a green change (the LLM veto gates).
const oldAndGate: CandidateGate = () => false;
// NEW gate (crit 1 falsifiability): a NON-falsifiable-doubt FAIL over a real change-set ACCEPTS;
// a concrete fault still rejects.
const falsifiabilityGate: CandidateGate = (input) =>
  isNonFalsifiableReviewDoubt(input.inputText) && input.changeSet.length > 0;

async function seedCorpus() {
  for (const r of FALSE_REJECTS) {
    await recordGateEval(projectDir, { leafId: r.leafId, gate: 'g3', inputText: r.inputText, changeSet: CHANGE_SET, verdict: 'fail', reasons: 'c2d640ec over-rejection (hand-built correct)' });
    await setOverride(projectDir, r.leafId, 'accepted-by-hand-build'); // ground truth: should-ACCEPT
  }
  // control fault — no override ⇒ ground truth should-REJECT
  await recordGateEval(projectDir, { leafId: REAL_FAULT.leafId, gate: 'g3', inputText: REAL_FAULT.inputText, changeSet: CHANGE_SET, verdict: 'fail', reasons: 'genuine fault control' });
}

test('crit 5: the OLD AND-gate false-rejects all 4 c2d640ec labels (fn >= 4)', async () => {
  await seedCorpus();
  const old = replayCorpus(projectDir, oldAndGate);
  expect(old.fn).toBeGreaterThanOrEqual(4); // rejected every should-accept
  // (the control fault is correctly rejected by the old gate — not an fn)
  expect(old.deltas.filter((d) => d.kind === 'fn').map((d) => d.leafId).sort())
    .toEqual(['0351e1e4', '0db337ab', '6619c55b', '6d67a801']);
});

test('crit 5: the NEW falsifiability gate drives false-rejects to ZERO (fn == 0) and does not over-accept the real fault', async () => {
  await seedCorpus();
  const next = replayCorpus(projectDir, falsifiabilityGate);
  expect(next.fn).toBe(0); // no should-accept is rejected any more
  expect(next.fp).toBe(0); // the genuine fault control is still rejected (not falsely accepted)
});

test('crit 5 report: new gate strictly improves the false-reject count vs the old gate', async () => {
  await seedCorpus();
  const old = replayCorpus(projectDir, oldAndGate);
  const next = replayCorpus(projectDir, falsifiabilityGate);
  // the measured calibration result (the recorded report):
  const report = { total: old.total, oldFn: old.fn, newFn: next.fn, oldFp: old.fp, newFp: next.fp };
  expect(report).toEqual({ total: 5, oldFn: 4, newFn: 0, oldFp: 0, newFp: 0 });
});
