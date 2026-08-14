/**
 * red-trunk-silence-alarm.test.ts — the trunk-level silence alarm (mission-stall.ts
 * sweepRedTrunkSilence).
 *
 * Origin (2026-08-14): master sat RED for 7+ hours with zero escalations — the repair
 * filing was unschedulable and nothing alarmed on the silence. These tests pin the
 * contract: a 'fail' trunk verdict + zero baseRepair dispatches for the 30-minute window
 * raises exactly ONE deduped 'blocker' card (sha-keyed condition, stamped timeoutMs,
 * failing files + repair-todo state named); a green trunk verdict auto-resolves it; a
 * fresh red at a NEW trunk sha after resolve re-arms.
 *
 * Fully hermetic: every dep (clock, verdict reader, dispatch reader, escalate fn) is an
 * injected fake — no store, no git, no ledger. The bunfig preload tripwire guards the rest.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  sweepRedTrunkSilence,
  redTrunkSilenceConditionKey,
  extractFailingFiles,
  _resetRedTrunkSilence,
  RED_TRUNK_SILENCE_KIND,
  RED_TRUNK_SILENCE_WINDOW_MS,
  RED_TRUNK_SILENCE_CARD_TIMEOUT_MS,
  type RedTrunkSilenceCard,
  type RedTrunkSilenceDeps,
  type TrunkVerdictFacts,
  type RepairTodoState,
} from '../mission-stall.ts';
import { runMissionLoopPass } from '../mission-loop.ts';

const PROJECT = '/p';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const T0 = 1_755_000_000_000;
const MIN = 60_000;

/** A fail verdict's resultJson in the shared spine's LeafGateResult shape. */
const FAIL_RESULT_JSON = JSON.stringify({
  status: 'fail',
  output: '2 new file(s) FAILED: src/services/__tests__/foo.test.ts src/services/__tests__/bar.test.ts',
  reasons: ['base gate: 2 new file(s) FAILED'],
  declared: true,
});

interface Harness {
  deps: RedTrunkSilenceDeps;
  raised: RedTrunkSilenceCard[];
  resolved: string[];
  setNow: (t: number) => void;
  setVerdict: (v: TrunkVerdictFacts | null) => void;
  setLastDispatch: (t: number | null) => void;
  setRepairState: (s: RepairTodoState) => void;
}

function makeHarness(): Harness {
  let now = T0;
  let verdict: TrunkVerdictFacts | null = null;
  let lastDispatch: number | null = null;
  let repairState: RepairTodoState = 'unclaimable';
  const raised: RedTrunkSilenceCard[] = [];
  const resolved: string[] = [];
  return {
    raised,
    resolved,
    setNow: (t) => { now = t; },
    setVerdict: (v) => { verdict = v; },
    setLastDispatch: (t) => { lastDispatch = t; },
    setRepairState: (s) => { repairState = s; },
    deps: {
      now: () => now,
      readTrunkVerdict: () => verdict,
      lastBaseRepairDispatchAt: () => lastDispatch,
      repairTodoState: () => repairState,
      escalate: (card) => { raised.push(card); },
      resolveOpenCard: (key) => { resolved.push(key); },
    },
  };
}

function failVerdict(sha: string, measuredAt: number): TrunkVerdictFacts {
  return { status: 'fail', baseSha: sha, resultJson: FAIL_RESULT_JSON, measuredAt };
}

beforeEach(() => {
  _resetRedTrunkSilence();
});

describe('red-trunk silence alarm', () => {
  test('fail verdict + undispatched repair: silent before the window, exactly one card at 30 min, second sweep dedups', () => {
    const h = makeHarness();
    h.setVerdict(failVerdict(SHA_A, T0));
    h.setLastDispatch(null); // the repair epic has NEVER been dispatched
    h.setRepairState('unclaimable');

    // 10 minutes in: red, but the window has not elapsed — no card yet.
    h.setNow(T0 + 10 * MIN);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps)).toEqual({ action: 'none', conditionKey: null });
    expect(h.raised.length).toBe(0);

    // 30 minutes in: the condition holds — exactly ONE card.
    h.setNow(T0 + RED_TRUNK_SILENCE_WINDOW_MS);
    const out = sweepRedTrunkSilence(PROJECT, SHA_A, h.deps);
    expect(out.action).toBe('raised');
    expect(out.conditionKey).toBe(redTrunkSilenceConditionKey(SHA_A));
    expect(h.raised.length).toBe(1);

    const card = h.raised[0]!;
    // The condition key INCLUDES the trunk sha.
    expect(card.conditionKey).toBe(`red-trunk-silence:${SHA_A}`);
    expect(card.conditionTuple).toEqual(['red-trunk-silence', SHA_A]);
    // A 'blocker' card with a STAMPED timeout.
    expect(card.kind).toBe(RED_TRUNK_SILENCE_KIND);
    expect(card.kind).toBe('blocker');
    expect(card.timeoutMs).toBe(RED_TRUNK_SILENCE_CARD_TIMEOUT_MS);
    // Names the failing files (from the verdict's resultJson) and the repair todo state.
    expect(card.questionText).toContain('src/services/__tests__/foo.test.ts');
    expect(card.questionText).toContain('src/services/__tests__/bar.test.ts');
    expect(card.questionText).toContain('UNCLAIMABLE');
    expect(card.questionText).toContain(SHA_A.slice(0, 8));

    // Second sweep of the SAME red: dedup — nothing raised, nothing resolved.
    h.setNow(T0 + RED_TRUNK_SILENCE_WINDOW_MS + 5 * MIN);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps)).toEqual({
      action: 'none',
      conditionKey: redTrunkSilenceConditionKey(SHA_A),
    });
    expect(h.raised.length).toBe(1);
    expect(h.resolved.length).toBe(0);
  });

  test('a recent baseRepair dispatch suppresses the alarm (silence is the condition, not redness)', () => {
    const h = makeHarness();
    h.setVerdict(failVerdict(SHA_A, T0));
    h.setNow(T0 + 40 * MIN);
    h.setLastDispatch(T0 + 35 * MIN); // a repair dispatch 5 minutes ago — someone IS coming
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('none');
    expect(h.raised.length).toBe(0);

    // The dispatch ages past the window with the trunk still red → now it alarms.
    h.setNow(T0 + 35 * MIN + RED_TRUNK_SILENCE_WINDOW_MS);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('raised');
    expect(h.raised.length).toBe(1);
  });

  test('green trunk verdict auto-resolves the open card', () => {
    const h = makeHarness();
    h.setVerdict(failVerdict(SHA_A, T0));
    h.setNow(T0 + RED_TRUNK_SILENCE_WINDOW_MS);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('raised');

    // The trunk goes green (same sha re-measured pass, e.g. after a hand-fix + invalidate).
    h.setVerdict({ status: 'pass', baseSha: SHA_A, resultJson: null, measuredAt: T0 + 60 * MIN });
    h.setNow(T0 + 61 * MIN);
    const out = sweepRedTrunkSilence(PROJECT, SHA_A, h.deps);
    expect(out.action).toBe('resolved');
    expect(h.resolved).toEqual([redTrunkSilenceConditionKey(SHA_A)]);

    // Steady green afterwards: nothing to do.
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('none');
    expect(h.raised.length).toBe(1);
    expect(h.resolved.length).toBe(1);
  });

  test('an UNMEASURED trunk is not green: no auto-resolve, no raise', () => {
    const h = makeHarness();
    h.setVerdict(failVerdict(SHA_A, T0));
    h.setNow(T0 + RED_TRUNK_SILENCE_WINDOW_MS);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('raised');

    // Trunk moves to an unmeasured sha — absence of a verdict resolves nothing.
    h.setVerdict(null);
    expect(sweepRedTrunkSilence(PROJECT, SHA_B, h.deps).action).toBe('none');
    expect(h.resolved.length).toBe(0);
  });

  test('fresh red at a NEW trunk sha after resolve re-arms with a new sha-keyed card', () => {
    const h = makeHarness();

    // Episode 1: red at sha A → card → green → resolved.
    h.setVerdict(failVerdict(SHA_A, T0));
    h.setNow(T0 + RED_TRUNK_SILENCE_WINDOW_MS);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('raised');
    h.setVerdict({ status: 'pass', baseSha: SHA_A, resultJson: null, measuredAt: T0 + 60 * MIN });
    h.setNow(T0 + 61 * MIN);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('resolved');

    // Episode 2: a land moves trunk to sha B, which goes red and sits silent 30 min.
    const t2 = T0 + 120 * MIN;
    h.setVerdict(failVerdict(SHA_B, t2));
    h.setRepairState('absent');
    h.setNow(t2 + RED_TRUNK_SILENCE_WINDOW_MS);
    const out = sweepRedTrunkSilence(PROJECT, SHA_B, h.deps);
    expect(out.action).toBe('raised');
    expect(out.conditionKey).toBe(`red-trunk-silence:${SHA_B}`);
    expect(h.raised.length).toBe(2);
    expect(h.raised[1]!.conditionKey).toBe(redTrunkSilenceConditionKey(SHA_B));
    expect(h.raised[1]!.questionText).toContain('NO repair todo exists');
  });

  test('new red at a new sha while an old-sha card is open: old card resolved, new card raised', () => {
    const h = makeHarness();
    h.setVerdict(failVerdict(SHA_A, T0));
    h.setNow(T0 + RED_TRUNK_SILENCE_WINDOW_MS);
    expect(sweepRedTrunkSilence(PROJECT, SHA_A, h.deps).action).toBe('raised');

    // Trunk lands forward to sha B, which is ALSO red and sits silent.
    const t2 = T0 + 60 * MIN;
    h.setVerdict(failVerdict(SHA_B, t2));
    h.setNow(t2 + RED_TRUNK_SILENCE_WINDOW_MS);
    const out = sweepRedTrunkSilence(PROJECT, SHA_B, h.deps);
    expect(out.action).toBe('raised');
    expect(h.resolved).toEqual([redTrunkSilenceConditionKey(SHA_A)]); // stale card auto-resolved
    expect(h.raised.map((c) => c.conditionKey)).toEqual([
      redTrunkSilenceConditionKey(SHA_A),
      redTrunkSilenceConditionKey(SHA_B),
    ]);
  });

  test('extractFailingFiles reads file names out of resultJson and survives corrupt blobs', () => {
    expect(extractFailingFiles(FAIL_RESULT_JSON)).toEqual([
      'src/services/__tests__/foo.test.ts',
      'src/services/__tests__/bar.test.ts',
    ]);
    expect(extractFailingFiles(null)).toEqual([]);
    expect(extractFailingFiles('{not json')).toEqual([]);
    expect(extractFailingFiles(JSON.stringify({ output: 42, reasons: 'nope' }))).toEqual([]);
  });

  test('runMissionLoopPass wires the sweep once per pass (injectable seam)', async () => {
    const calls: Array<{ project: string; now: number }> = [];
    const result = await runMissionLoopPass(PROJECT, {
      list: () => [],
      redTrunkSweep: (project, now) => { calls.push({ project, now }); },
      resolveTarget: () => 'conductor',
      now: T0,
    });
    expect(result.project).toBe(PROJECT);
    expect(calls).toEqual([{ project: PROJECT, now: T0 }]);
  });

  test('a throwing sweep never breaks the pass (fail-open)', async () => {
    const result = await runMissionLoopPass(PROJECT, {
      list: () => [],
      redTrunkSweep: () => { throw new Error('boom'); },
      resolveTarget: () => 'conductor',
      now: T0,
    });
    expect(result.nudged).toEqual([]);
  });
});
