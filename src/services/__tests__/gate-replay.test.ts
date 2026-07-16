import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { recordGateEval, setOverride, _closeProject } from '../replay-corpus-store';
import { replayCorpus, type CandidateGate } from '../gate-replay';
import { validateReviewGrounding } from '../review-citations';
import { addWatchedProject, removeWatchedProject, getGateShadowMode, setGateShadowMode, _closeDb } from '../supervisor-store';

let projectDir: string;
// Isolate the supervisor DB to a throwaway dir so this test never writes
// gate-replay-test-* rows into the real ~/.mermaid-collab/supervisor.db (which
// the UI Projects list renders). openDb() caches its handle, so we must _closeDb()
// AFTER setting the env for the change to take effect.
let supDir: string;
let priorSupDir: string | undefined;

beforeEach(() => {
  priorSupDir = process.env.MERMAID_SUPERVISOR_DIR;
  supDir = mkdtempSync(`${tmpdir()}/gate-replay-supdir-`);
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb(); // drop any cached handle so the next openDb() uses the isolated dir
  projectDir = mkdtempSync(`${tmpdir()}/gate-replay-test-`);
});

afterEach(() => {
  _closeProject(projectDir);
  removeWatchedProject(projectDir); // belt-and-suspenders in the isolated dir
  _closeDb();
  if (priorSupDir === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
  else process.env.MERMAID_SUPERVISOR_DIR = priorSupDir;
  try { rmSync(supDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('seed + current gate → 0 FP / 0 FN', async () => {
  // Seed the 8dbbdc8d row (vacuous, non-empty change-set)
  await recordGateEval(projectDir, {
    leafId: '8dbbdc8d',
    gate: 'citability',
    inputText: `## CRITERIA
1. \`McBridge.addSpellCheckWords?: (words: string[]) => void;\` declared — ui/src/contexts/ServerContext.tsx:70
   - [MET]
2. \`useAutocorrect\` return type includes \`vocabWords\` — ui/src/hooks/useAutocorrect.ts:18, ui/src/hooks/useAutocorrect.ts:79
   - [MET]

VERDICT: PASS`,
    changeSet: ['ui/src/contexts/ServerContext.tsx', 'ui/src/hooks/useAutocorrect.ts'],
    verdict: 'vacuous',
    reasons: 'test fixture',
  });

  // Seed the c8a58a92 row (empty change-set, retained-mode)
  await recordGateEval(projectDir, {
    leafId: 'c8a58a92',
    gate: 'citability',
    inputText: `1. [MET] preload exposes abort — bsync-viewer/desktop/preload.cjs:86
2. [MET] chat-preload tracks turnId — bsync-viewer/desktop/assistant/chat-preload.cjs:5`,
    changeSet: [],
    verdict: 'vacuous',
    reasons: 'test fixture',
  });

  // Override both to ground-truth ACCEPT
  await setOverride(projectDir, '8dbbdc8d', 'accept');
  await setOverride(projectDir, 'c8a58a92', 'accept');

  // Define the current gate (validateReviewGrounding with retained-mode tolerance)
  const current: CandidateGate = ({ inputText, changeSet }) =>
    validateReviewGrounding(inputText, changeSet, { citationExists: () => true }).status === 'ok';

  const result = replayCorpus(projectDir, current);
  expect(result.total).toBe(2);
  expect(result.fp).toBe(0);
  expect(result.fn).toBe(0);
  expect(result.deltas).toHaveLength(0);
});

test('broken gate → reports the FN it introduces', async () => {
  // Seed both rows
  await recordGateEval(projectDir, {
    leafId: '8dbbdc8d',
    gate: 'citability',
    inputText: `## CRITERIA
1. \`McBridge.addSpellCheckWords?: (words: string[]) => void;\` declared — ui/src/contexts/ServerContext.tsx:70
   - [MET]
2. \`useAutocorrect\` return type includes \`vocabWords\` — ui/src/hooks/useAutocorrect.ts:18, ui/src/hooks/useAutocorrect.ts:79
   - [MET]

VERDICT: PASS`,
    changeSet: ['ui/src/contexts/ServerContext.tsx', 'ui/src/hooks/useAutocorrect.ts'],
    verdict: 'vacuous',
    reasons: 'test fixture',
  });

  await recordGateEval(projectDir, {
    leafId: 'c8a58a92',
    gate: 'citability',
    inputText: `1. [MET] preload exposes abort — bsync-viewer/desktop/preload.cjs:86
2. [MET] chat-preload tracks turnId — bsync-viewer/desktop/assistant/chat-preload.cjs:5`,
    changeSet: [],
    verdict: 'vacuous',
    reasons: 'test fixture',
  });

  // Override both to ground-truth ACCEPT
  await setOverride(projectDir, '8dbbdc8d', 'accept');
  await setOverride(projectDir, 'c8a58a92', 'accept');

  // A deliberately broken gate that always rejects
  const broken: CandidateGate = () => false;

  const result = replayCorpus(projectDir, broken);
  expect(result.fn).toBe(2);
  expect(result.fp).toBe(0);
  expect(result.deltas).toHaveLength(2);
  const leafIds = new Set(result.deltas.map(d => d.leafId));
  expect(leafIds).toContain('8dbbdc8d');
  expect(leafIds).toContain('c8a58a92');
  for (const delta of result.deltas) {
    expect(delta.kind).toBe('fn');
  }
});

test('gateShadowMode round-trips (default false)', () => {
  addWatchedProject(projectDir);
  expect(getGateShadowMode(projectDir)).toBe(false);
  setGateShadowMode(projectDir, true);
  expect(getGateShadowMode(projectDir)).toBe(true);
  setGateShadowMode(projectDir, false);
  expect(getGateShadowMode(projectDir)).toBe(false);
});
