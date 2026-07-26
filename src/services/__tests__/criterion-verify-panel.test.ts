import { test, expect, describe } from 'bun:test';
import {
  VERIFY_LENSES,
  buildLensEvidenceBlock,
  buildLensVerifyPrompt,
  parseLensVerdict,
  joinPanelVerdicts,
  type VerifyLens,
  type LensVerifyCtx,
  type PanelVerdict,
} from '../criterion-verify-panel';

describe('criterion-verify-panel', () => {
  test('VERIFY_LENSES contains exactly the three expected lenses in order', () => {
    expect(VERIFY_LENSES).toEqual([
      'evidence-exists',
      'regression-red-when-neutered',
      'holds-at-head',
    ]);
  });

  test('all three prompts are pairwise distinct and each includes the identical evidence block', () => {
    const ctx: LensVerifyCtx = {
      criterionText: 'Test criterion text',
      evidence: 'Test evidence description',
      evidencePaths: ['src/a.ts', 'src/b.ts'],
      verifiedAtSha: 'abc123def456',
    };

    const evidenceBlock = buildLensEvidenceBlock(ctx);

    const prompts: Record<VerifyLens, string> = {
      'evidence-exists': buildLensVerifyPrompt('evidence-exists', ctx),
      'regression-red-when-neutered': buildLensVerifyPrompt('regression-red-when-neutered', ctx),
      'holds-at-head': buildLensVerifyPrompt('holds-at-head', ctx),
    };

    // All three prompts must be distinct
    const promptList = Object.values(prompts);
    expect(promptList[0] !== promptList[1]).toBe(true);
    expect(promptList[0] !== promptList[2]).toBe(true);
    expect(promptList[1] !== promptList[2]).toBe(true);

    // Each prompt must include the identical evidence block
    expect(prompts['evidence-exists']).toContain(evidenceBlock);
    expect(prompts['regression-red-when-neutered']).toContain(evidenceBlock);
    expect(prompts['holds-at-head']).toContain(evidenceBlock);
  });

  test('parseLensVerdict returns "met" for VERDICT: PASS (case insensitive)', () => {
    expect(parseLensVerdict('VERDICT: PASS')).toBe('met');
    expect(parseLensVerdict('VERDICT: pass')).toBe('met');
    expect(parseLensVerdict('verdict: PASS')).toBe('met');
    expect(parseLensVerdict('  VERDICT: PASS  ')).toBe('met');
  });

  test('parseLensVerdict returns "not-met" for VERDICT: FAIL (case insensitive)', () => {
    expect(parseLensVerdict('VERDICT: FAIL — reason here')).toBe('not-met');
    expect(parseLensVerdict('VERDICT: fail')).toBe('not-met');
    expect(parseLensVerdict('verdict: FAIL')).toBe('not-met');
  });

  test('parseLensVerdict returns "error" for empty, undefined, and unparseable input', () => {
    expect(parseLensVerdict('')).toBe('error');
    expect(parseLensVerdict('   ')).toBe('error');
    expect(parseLensVerdict(undefined)).toBe('error');
    expect(parseLensVerdict('Some prose without a VERDICT line')).toBe('error');
    expect(parseLensVerdict('verdict: MAYBE')).toBe('error');
  });

  test('parseLensVerdict ignores markdown formatting characters', () => {
    expect(parseLensVerdict('**VERDICT: PASS**')).toBe('met');
    expect(parseLensVerdict('`VERDICT: PASS`')).toBe('met');
    expect(parseLensVerdict('_VERDICT: FAIL_')).toBe('not-met');
    expect(parseLensVerdict('"VERDICT: PASS"')).toBe('met');
  });

  test('joinPanelVerdicts with 2 met + 1 not-met returns met: true, no split', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'file exists' },
      { lens: 'regression-red-when-neutered', met: true, reason: 'test reds on neutering' },
      { lens: 'holds-at-head', met: false, reason: 'claim no longer holds' },
    ];

    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(true);
    expect(result.split).toBeUndefined();
    expect(result.dissent).toBeUndefined();
  });

  test('joinPanelVerdicts with 1-of-2 met returns met: false, split: true with dissent', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'cited text found' },
      { lens: 'holds-at-head', met: false, reason: 'reverted at HEAD' },
    ];

    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    expect(result.dissent).toContain('holds-at-head');
    expect(result.dissent).toContain('reverted at HEAD');
  });

  test('joinPanelVerdicts with 1-of-3 met returns met: false, split: true with dissent for both dissenters', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'found' },
      { lens: 'regression-red-when-neutered', met: false, reason: 'test stays green' },
      { lens: 'holds-at-head', met: false, reason: 'no longer true' },
    ];

    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    expect(result.dissent).toContain('regression-red-when-neutered');
    expect(result.dissent).toContain('test stays green');
    expect(result.dissent).toContain('holds-at-head');
    expect(result.dissent).toContain('no longer true');
  });

  test('joinPanelVerdicts with empty input returns met: false, split: true, fail-closed', () => {
    const result = joinPanelVerdicts([]);
    expect(result.met).toBe(false);
    expect(result.split).toBe(true);
    expect(result.dissent).toBeDefined();
  });

  test('joinPanelVerdicts with all met returns met: true, no split', () => {
    const verdicts: PanelVerdict[] = [
      { lens: 'evidence-exists', met: true, reason: 'file exists' },
      { lens: 'regression-red-when-neutered', met: true, reason: 'test reds' },
      { lens: 'holds-at-head', met: true, reason: 'still true' },
    ];

    const result = joinPanelVerdicts(verdicts);
    expect(result.met).toBe(true);
    expect(result.split).toBeUndefined();
    expect(result.dissent).toBeUndefined();
  });

  test('buildLensEvidenceBlock includes criterion text, evidence, and paths', () => {
    const ctx: LensVerifyCtx = {
      criterionText: 'Example criterion',
      evidence: 'Example evidence',
      evidencePaths: ['file1.ts', 'file2.ts'],
      verifiedAtSha: 'sha1234',
    };

    const block = buildLensEvidenceBlock(ctx);
    expect(block).toContain('Example criterion');
    expect(block).toContain('Example evidence');
    expect(block).toContain('file1.ts');
    expect(block).toContain('file2.ts');
  });

  test('buildLensEvidenceBlock handles null evidence gracefully', () => {
    const ctx: LensVerifyCtx = {
      criterionText: 'No evidence criterion',
      evidence: null,
      evidencePaths: ['src/file.ts'],
      verifiedAtSha: 'abc123',
    };

    const block = buildLensEvidenceBlock(ctx);
    expect(block).toContain('No evidence criterion');
    expect(block).toContain('abc123');
    expect(block).toContain('src/file.ts');
  });

  test('buildLensEvidenceBlock handles empty paths list', () => {
    const ctx: LensVerifyCtx = {
      criterionText: 'Criterion with no paths',
      evidence: 'Some evidence',
      evidencePaths: [],
      verifiedAtSha: 'xyz789',
    };

    const block = buildLensEvidenceBlock(ctx);
    expect(block).toContain('Criterion with no paths');
    expect(block).toContain('none');
  });
});
