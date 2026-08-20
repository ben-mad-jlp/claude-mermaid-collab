// Runs via `bun test`.
//
// Regression: the evidence-exists lens prompt said "A file that does not exist ... is a FAIL",
// with no instruction to look anywhere else. Builders follow the repo's own layout, so a
// criterion that names a plausible path while the proof lives under the project's test
// directories produced a HOLD with EMPTY evidencePaths on work that existed and passed —
// live on the qbs project 2026-08-20 (three criteria cited AddLineItemDialog.test.tsx while
// six substantive named tests sat in src/features/sales-entry/__tests__/).
import { describe, test, expect } from 'bun:test';
import { buildLensVerifyPrompt, type LensVerifyCtx } from '../criterion-verify-panel';

const CTX: LensVerifyCtx = {
  criterionText: "a test file contains it('holds a sale for confirmation')",
  evidence: 'AddLineItemDialog.test.tsx line 42',
  evidencePaths: ['AddLineItemDialog.test.tsx'],
  verifiedAtSha: 'abc1234',
  project: '/repo/qbs',
} as LensVerifyCtx;

describe('evidence-exists lens resolves assertions by name, not by filename', () => {
  test('the prompt tells the lens to search the test directories when a named path is absent', () => {
    const p = buildLensVerifyPrompt('evidence-exists', CTX);
    expect(p).toContain('A NAMED PATH THAT IS ABSENT IS NOT BY ITSELF A FAIL');
    expect(p).toContain('SEARCH');
    expect(p).toMatch(/\(it\|test\)/);
    expect(p).toContain('Judge the ASSERTION');
  });

  test('the prompt requires every verdict to enumerate the paths it examined', () => {
    const p = buildLensVerifyPrompt('evidence-exists', CTX);
    expect(p).toContain('Enumerate in evidencePaths every path you actually examined');
    expect(p).toContain('A verdict that examined nothing cites nothing and decides nothing.');
  });

  test('the FAIL condition requires the assertion to appear nowhere in the project', () => {
    const p = buildLensVerifyPrompt('evidence-exists', CTX);
    expect(p).toContain('FAIL only when the cited text and the quoted assertion names appear NOWHERE');
  });

  test('the other two lenses keep their instructions verbatim (change is scoped to one lens)', () => {
    const neutered = buildLensVerifyPrompt('regression-red-when-neutered', CTX);
    expect(neutered).toContain('## Lens: regression-red-when-neutered');
    expect(neutered).toContain('If the test goes RED under');
    expect(neutered).not.toContain('A NAMED PATH THAT IS ABSENT');

    const head = buildLensVerifyPrompt('holds-at-head', CTX);
    expect(head).toContain('## Lens: holds-at-head');
    expect(head).toContain('Re-check the claim at the current HEAD commit');
    expect(head).not.toContain('A NAMED PATH THAT IS ABSENT');
  });
});
