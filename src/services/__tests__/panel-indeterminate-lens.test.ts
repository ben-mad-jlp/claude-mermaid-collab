/** Unit tests for lens outcome classification and indeterminate handling.
 *  Tests classifyLensOutcome and the join rule's filtering of infra faults. */
import { describe, test, expect } from 'bun:test';
import { classifyLensOutcome, joinPanelVerdicts } from '../criterion-verify-panel';
import type { PanelVerdict } from '../criterion-verify-panel';

describe('classifyLensOutcome', () => {
  test('returns infra for an ok node whose text is the live Fable 5 limit sentence', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'error',
      text: "You've reached your Fable 5 limit",
    });
    expect(result).toBe('infra');
  });

  test('returns infra for a timedOut node', () => {
    const result = classifyLensOutcome({
      ok: false,
      exitCode: undefined,
      timedOut: true,
      parsed: 'error',
    });
    expect(result).toBe('infra');
  });

  test('returns infra for a rateLimited node', () => {
    const result = classifyLensOutcome({
      ok: false,
      exitCode: undefined,
      rateLimited: true,
      parsed: 'error',
    });
    expect(result).toBe('infra');
  });

  test('returns infra for a startFailure node', () => {
    const result = classifyLensOutcome({
      ok: false,
      exitCode: undefined,
      startFailure: { provider: 'anthropic', model: 'claude-opus', detail: 'auth failed' },
      parsed: 'error',
    });
    expect(result).toBe('infra');
  });

  test('returns not-met for a genuine VERDICT FAIL', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'not-met',
      text: '…\nVERDICT: FAIL — evidence missing',
    });
    expect(result).toBe('not-met');
  });

  test('returns met for a genuine VERDICT PASS', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'met',
      text: 'Evidence found. \nVERDICT: PASS',
    });
    expect(result).toBe('met');
  });

  test('returns infra when text matches quota exhausted pattern', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'error',
      text: 'quota exhausted',
    });
    expect(result).toBe('infra');
  });

  test('returns infra when text matches rate limit pattern', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'error',
      text: 'rate limit exceeded',
    });
    expect(result).toBe('infra');
  });

  test('returns infra when text matches overloaded pattern', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'error',
      text: 'service overloaded',
    });
    expect(result).toBe('infra');
  });

  test('returns infra when text matches 429 pattern', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'error',
      text: 'HTTP 429 Too Many Requests',
    });
    expect(result).toBe('infra');
  });

  test('returns infra when text matches curly apostrophe limit variant', () => {
    const result = classifyLensOutcome({
      ok: true,
      exitCode: 0,
      parsed: 'error',
      text: "You've reached your Claude limit",
    });
    expect(result).toBe('infra');
  });

  test('returns not-met for a parsed not-met verdict even with non-zero exit', () => {
    const result = classifyLensOutcome({
      ok: false,
      exitCode: 1,
      parsed: 'not-met',
      text: 'VERDICT: FAIL — some reason',
    });
    expect(result).toBe('not-met');
  });
});

describe('joinPanelVerdicts with indeterminate lenses', () => {
  test('filters indeterminate verdicts before majority computation', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: '', indeterminate: false },
      { lens: 'regression-red-when-neutered', met: true, reason: '' },
      { lens: 'holds-at-head', met: false, reason: 'RATE-LIMIT-SENTINEL', indeterminate: true },
    ];
    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(true);
    expect(result.dissent).toBeUndefined();
  });

  test('returns indeterminate true when every lens is indeterminate', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: false, reason: 'timeout', indeterminate: true },
      { lens: 'regression-red-when-neutered', met: false, reason: 'rate limit', indeterminate: true },
      { lens: 'holds-at-head', met: false, reason: 'start failure', indeterminate: true },
    ];
    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    expect(result.indeterminate).toBe(true);
    expect(result.dissent).toBe('all lenses indeterminate (infra)');
  });

  test('computes majority over effective lenses when some are indeterminate', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: false, reason: 'not found' },
      { lens: 'regression-red-when-neutered', met: false, reason: 'test green' },
      { lens: 'holds-at-head', met: false, reason: 'rate limited', indeterminate: true },
    ];
    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    // dissent should only contain the two effective (non-indeterminate) lenses
    expect(result.dissent).toContain('evidence-exists');
    expect(result.dissent).toContain('regression-red-when-neutered');
    expect(result.dissent).not.toContain('rate limited');
  });

  test('empty verdict array still fails closed', () => {
    const result = joinPanelVerdicts([]);
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    expect(result.dissent).toBe('no verdicts received');
  });

  test('parity: verdicts with no indeterminate field grade as today (strict majority)', () => {
    // This ensures the parity pin test remains unbroken.
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: '' },
      { lens: 'regression-red-when-neutered', met: true, reason: '' },
      { lens: 'holds-at-head', met: false, reason: 'evidence missing' },
    ];
    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(true);
    expect(result.dissent).toBeUndefined();
  });

  test('mixed indeterminate status: 2 met, 1 indeterminate → met passes', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: '' },
      { lens: 'regression-red-when-neutered', met: true, reason: '' },
      { lens: 'holds-at-head', met: false, reason: 'infra timeout', indeterminate: true },
    ];
    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(true);
  });

  test('mixed indeterminate status: 1 met, 1 not-met, 1 indeterminate → not-met fails', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: '' },
      { lens: 'regression-red-when-neutered', met: false, reason: 'test failed' },
      { lens: 'holds-at-head', met: false, reason: 'rate limited', indeterminate: true },
    ];
    const result = joinPanelVerdicts(verdicts);
    // Effective is [met:true, met:false] = 1 of 2, so !isMet
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    // dissent should only mention the effective lens that didn't meet
    expect(result.dissent).toContain('regression-red-when-neutered');
    expect(result.dissent).not.toContain('rate limited');
  });
});
