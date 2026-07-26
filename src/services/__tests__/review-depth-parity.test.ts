import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  recordGateEval,
  _closeProject,
  listGateEvals,
} from '../replay-corpus-store';
import {
  isLightPathParityMet,
  measureReviewDepthParity,
  recordReviewDepthParity,
  readReviewDepthParity,
  reviewDepthThresholdKey,
  REVIEW_DEPTH_PARITY_LEAF_ID,
  PARITY_AGREEMENT_FLOOR,
  PARITY_MIN_SAMPLES,
} from '../review-depth-parity';
import { _closeDb } from '../supervisor-store';

let projectDir: string;
let supDir: string;
let priorSupDir: string | undefined;

beforeEach(() => {
  priorSupDir = process.env.MERMAID_SUPERVISOR_DIR;
  supDir = mkdtempSync(`${tmpdir()}/review-depth-parity-supdir-`);
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
  projectDir = mkdtempSync(`${tmpdir()}/review-depth-parity-test-`);
});

afterEach(() => {
  _closeProject(projectDir);
  _closeDb();
  if (priorSupDir === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
  else process.env.MERMAID_SUPERVISOR_DIR = priorSupDir;
  try { rmSync(supDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('light path stays disabled when no parity measurement is recorded', () => {
  expect(isLightPathParityMet(projectDir)).toBe(false);
});

test('light path enables once a passing parity measurement is stored', async () => {
  const m = {
    thresholdKey: reviewDepthThresholdKey(),
    sampleSize: PARITY_MIN_SAMPLES,
    agreements: PARITY_MIN_SAMPLES,
    agreementRate: 1.0,
    standard: { total: PARITY_MIN_SAMPLES, fp: 0, fn: 0, deltas: [] },
    light: { total: PARITY_MIN_SAMPLES, fp: 0, fn: 0, deltas: [] },
    deltas: [],
  };

  await recordReviewDepthParity(projectDir, m);
  expect(isLightPathParityMet(projectDir)).toBe(true);
});

test('light path stays off when stored measurement has stale threshold key', async () => {
  const m = {
    thresholdKey: 'v1:999,999,999,999', // stale key
    sampleSize: PARITY_MIN_SAMPLES,
    agreements: PARITY_MIN_SAMPLES,
    agreementRate: 1.0,
    standard: { total: PARITY_MIN_SAMPLES, fp: 0, fn: 0, deltas: [] },
    light: { total: PARITY_MIN_SAMPLES, fp: 0, fn: 0, deltas: [] },
    deltas: [],
  };

  await recordGateEval(projectDir, {
    leafId: REVIEW_DEPTH_PARITY_LEAF_ID,
    gate: 'review-depth',
    inputText: m.thresholdKey,
    changeSet: [],
    verdict: 'pass',
    reasons: JSON.stringify({
      sampleSize: m.sampleSize,
      agreementRate: m.agreementRate,
      deltas: m.deltas,
    }),
  });

  expect(isLightPathParityMet(projectDir)).toBe(false);
});

test('review-depth parity result round-trips through recordGateEval/listGateEvals', async () => {
  const m = {
    thresholdKey: reviewDepthThresholdKey(),
    sampleSize: 25,
    agreements: 24,
    agreementRate: 0.96,
    standard: { total: 25, fp: 0, fn: 0, deltas: [] },
    light: { total: 25, fp: 0, fn: 1, deltas: [] },
    deltas: [{ leafId: 'abc', gate: 'review-depth', expected: 'accept', actual: 'reject', kind: 'fn' }],
  };

  await recordReviewDepthParity(projectDir, m);

  const rows = listGateEvals(projectDir, { gate: 'review-depth' });
  expect(rows).toHaveLength(1);
  expect(rows[0].leafId).toBe(REVIEW_DEPTH_PARITY_LEAF_ID);
  expect(rows[0].inputText).toBe(reviewDepthThresholdKey());
  expect(rows[0].verdict).toBe('pass');

  const read = readReviewDepthParity(projectDir);
  expect(read).not.toBeNull();
  expect(read!.sampleSize).toBe(25);
  expect(read!.agreementRate).toBe(0.96);
  expect(read!.deltas).toHaveLength(1);
  expect(read!.deltas[0].leafId).toBe('abc');
});

test('parity verdict is fail when agreement rate below floor', async () => {
  const m = {
    thresholdKey: reviewDepthThresholdKey(),
    sampleSize: 30,
    agreements: 27,
    agreementRate: 0.9, // below PARITY_AGREEMENT_FLOOR (0.95)
    standard: { total: 30, fp: 0, fn: 0, deltas: [] },
    light: { total: 30, fp: 0, fn: 3, deltas: [] },
    deltas: [
      { leafId: 'a', gate: 'review-depth', expected: 'accept', actual: 'reject', kind: 'fn' },
      { leafId: 'b', gate: 'review-depth', expected: 'accept', actual: 'reject', kind: 'fn' },
      { leafId: 'c', gate: 'review-depth', expected: 'accept', actual: 'reject', kind: 'fn' },
    ],
  };

  const result = await recordReviewDepthParity(projectDir, m);
  expect(result.verdict).toBe('fail');
  expect(isLightPathParityMet(projectDir)).toBe(false);
});

test('parity verdict is fail when sample size below minimum', async () => {
  const m = {
    thresholdKey: reviewDepthThresholdKey(),
    sampleSize: 10, // below PARITY_MIN_SAMPLES (20)
    agreements: 10,
    agreementRate: 1.0,
    standard: { total: 10, fp: 0, fn: 0, deltas: [] },
    light: { total: 10, fp: 0, fn: 0, deltas: [] },
    deltas: [],
  };

  const result = await recordReviewDepthParity(projectDir, m);
  expect(result.verdict).toBe('fail');
  expect(isLightPathParityMet(projectDir)).toBe(false);
});

test('measureReviewDepthParity replays corpus with both standard and light gates', async () => {
  // Seed a corpus row that passes standard gate but fails light gate
  // (e.g., a small docs-only change that the light gate accepts without scrutiny)
  const thresholdKey = reviewDepthThresholdKey();

  // Row 1: docs-only change, light gate accepts without scrutiny (routes light)
  await recordGateEval(projectDir, {
    leafId: 'leaf-001',
    gate: 'review-depth',
    inputText: 'LOC:10/5',
    changeSet: ['docs/README.md', 'docs/guide.md'],
    verdict: 'pass',
    reasons: 'docs-only, no code changes',
  });

  // Row 2: code change, standard gate requires groundi ng check, light gate also routes light
  await recordGateEval(projectDir, {
    leafId: 'leaf-002',
    gate: 'review-depth',
    inputText: 'LOC:20/10',
    changeSet: ['src/util/foo.ts'],
    verdict: 'pass',
    reasons: 'small code change, passes grounding',
  });

  // Row 3: hot-path change, even light gate routes heavy and requires grounding check
  await recordGateEval(projectDir, {
    leafId: 'leaf-003',
    gate: 'review-depth',
    inputText: 'LOC:5/2',
    changeSet: ['src/services/mission-store.ts'],
    verdict: 'pass',
    reasons: 'hot-path change',
  });

  const parity = measureReviewDepthParity(projectDir);

  // All three rows are in the corpus
  expect(parity.sampleSize).toBeGreaterThanOrEqual(3);
  // Verify structure of parity result
  expect(parity.thresholdKey).toBe(thresholdKey);
  expect(typeof parity.agreementRate).toBe('number');
  expect(Array.isArray(parity.deltas)).toBe(true);
  expect(parity.standard).toHaveProperty('total');
  expect(parity.light).toHaveProperty('total');
});
