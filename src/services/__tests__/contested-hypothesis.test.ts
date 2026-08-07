/**
 * The contested-cause falsifier (handoff Finding 2).
 *
 * Regression spec from the handoff, verbatim: "given a leaf whose contested card cites a
 * dropped-symbol cause, and a merged file where that symbol has zero call sites, assert the
 * harness marks the hypothesis falsified and does NOT re-run an identical implement→review
 * cycle against the same wall."
 *
 * MUTATION CONTRACT: the falsified/supported split must key on the CALL-SITE COUNT, not on the
 * claim being parseable. Make falsifySymbolClaims always return 'supported' and Test C reds.
 * Make extractSymbolClaims return [] and Tests A/C/E red.
 */
import { describe, it, expect } from 'bun:test';
import {
  extractSymbolClaims,
  falsifySymbolClaims,
  summarizeHypothesisCheck,
  hasFalsifiedClaim,
} from '../contested-hypothesis';

/** The real review text from yolox-markup leaf 9acbb620, which cost two full cycles. */
const REAL_CLAIM = 'The merge dropped the capture_service and ssh_service imports.';

describe('extractSymbolClaims', () => {
  it('Test A: pulls both symbols out of the real-world claim', () => {
    const claims = extractSymbolClaims(REAL_CLAIM);
    expect(claims.map((c) => c.symbol).sort()).toEqual(['capture_service', 'ssh_service']);
  });

  it('Test B: handles the reversed order ("X was removed")', () => {
    expect(extractSymbolClaims('capture_store was removed by the refactor').map((c) => c.symbol))
      .toContain('capture_store');
  });

  it('Test C: does NOT fire without a drop verb — a false extraction is worse than none', () => {
    expect(extractSymbolClaims('capture_service is called with the wrong argument')).toEqual([]);
    expect(extractSymbolClaims('')).toEqual([]);
    expect(extractSymbolClaims(null)).toEqual([]);
  });

  it('Test D: skips connective noise so "the/and/imports" never become symbols', () => {
    const syms = extractSymbolClaims(REAL_CLAIM).map((c) => c.symbol);
    for (const noise of ['the', 'and', 'imports', 'merge', 'dropped']) {
      expect(syms).not.toContain(noise);
    }
  });
});

describe('falsifySymbolClaims', () => {
  it('Test E: ZERO call sites → falsified (the incident case)', async () => {
    const claims = extractSymbolClaims(REAL_CLAIM);
    const verdicts = await falsifySymbolClaims(claims, async () => 0);

    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((v) => v.status === 'falsified')).toBe(true);
    expect(hasFalsifiedClaim(verdicts)).toBe(true);

    const summary = summarizeHypothesisCheck(verdicts)!;
    expect(summary).toContain('FALSIFIED');
    expect(summary).toContain('ZERO call sites');
    // The instruction that actually breaks the loop.
    expect(summary).toContain('DIFFERENT hypothesis');
  });

  it('Test F: call sites exist → supported, and NOT treated as proof of cause', async () => {
    const verdicts = await falsifySymbolClaims(
      [{ symbol: 'capture_service', quote: REAL_CLAIM }],
      async () => 4,
    );
    expect(verdicts[0]!.status).toBe('supported');
    expect(verdicts[0]!.callSites).toBe(4);
    expect(hasFalsifiedClaim(verdicts)).toBe(false);
    expect(summarizeHypothesisCheck(verdicts)!).toContain('NOT proof');
  });

  it('Test G: a THROWING probe yields untested, never a false falsified', async () => {
    const verdicts = await falsifySymbolClaims(
      [{ symbol: 'capture_service', quote: REAL_CLAIM }],
      async () => { throw new Error('git grep unavailable'); },
    );
    expect(verdicts[0]!.status).toBe('untested');
    expect(verdicts[0]!.callSites).toBeNull();
    // The critical property: a broken probe must not read as evidence of absence.
    expect(hasFalsifiedClaim(verdicts)).toBe(false);
    expect(summarizeHypothesisCheck(verdicts)!).toContain('UNPROVEN');
  });

  it('Test H: mixed verdicts all survive into the summary', async () => {
    const verdicts = await falsifySymbolClaims(
      [
        { symbol: 'gone_symbol', quote: 'dropped gone_symbol' },
        { symbol: 'live_symbol', quote: 'dropped live_symbol' },
      ],
      async (sym) => (sym === 'gone_symbol' ? 0 : 7),
    );
    const summary = summarizeHypothesisCheck(verdicts)!;
    expect(summary).toContain('FALSIFIED');
    expect(summary).toContain('SUPPORTED');
    expect(hasFalsifiedClaim(verdicts)).toBe(true);
  });

  it('Test I: no claims → null summary, so a caller records nothing rather than an empty note', () => {
    expect(summarizeHypothesisCheck([])).toBeNull();
  });
});
