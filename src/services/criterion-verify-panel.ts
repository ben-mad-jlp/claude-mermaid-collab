/** Distinct-lens verification panel for mission criteria.
 *  A criterion truth is verified by three independent lenses, each asking a specific question,
 *  then joined by strict-majority vote. Verdicts are deterministic, LLM-free. */

export type VerifyLens = 'evidence-exists' | 'regression-red-when-neutered' | 'holds-at-head';

export const VERIFY_LENSES: readonly VerifyLens[] = [
  'evidence-exists',
  'regression-red-when-neutered',
  'holds-at-head',
];

export interface LensVerifyCtx {
  criterionText: string;
  evidence: string | null;
  evidencePaths: string[];
  verifiedAtSha: string | null;
}

export interface PanelVerdict {
  lens: VerifyLens;
  met: boolean;
  reason: string;
}

export interface PanelJoin {
  met: boolean;
  split?: boolean;
  dissent?: string;
}

/** Strip markdown formatting characters that can obscure VERDICT lines.
 *  Mirrors stripSentinelFmt in leaf-executor.ts:1669 for local fail-closed parsing. */
function stripSentinelFmt(text: string): string {
  return text.replace(/[`*_"']/g, '');
}

/** Parse an LLM verdict reply for a single lens, mirroring parseVerdict at leaf-executor.ts:1685.
 *  Fail-closed: only explicit VERDICT: PASS | FAIL lines are accepted.
 *  Empty, unparseable, or 'error' replies all return 'error' to be treated as not-met by join. */
export function parseLensVerdict(text: string | undefined): 'met' | 'not-met' | 'error' {
  if (!text || !text.trim()) return 'error';
  const m = stripSentinelFmt(text).match(/^\s*VERDICT:\s*(PASS|FAIL)\b/im);
  if (!m) return 'error';
  return m[1].toUpperCase() === 'PASS' ? 'met' : 'not-met';
}

/** Build the shared evidence block, identical across all three lenses.
 *  Includes criterion text, evidence prose (if any), and file paths. */
export function buildLensEvidenceBlock(ctx: LensVerifyCtx): string {
  const pathsList = ctx.evidencePaths.length > 0 ? ctx.evidencePaths.join('\n  - ') : 'none';

  return `## Criterion
${ctx.criterionText}

## Evidence
${ctx.evidence ?? '(no evidence prose — verdict is pinned to HEAD at ' + ctx.verifiedAtSha + ')'}

## Evidence paths
  - ${pathsList}`;
}

/** Lens-specific instruction blocks. */
const LENS_INSTRUCTIONS: Record<VerifyLens, string> = {
  'evidence-exists': `## Lens: evidence-exists
Verify that cited evidence actually exists in the files listed under Evidence paths.
Open each file, locate the exact text/citation given in the Evidence section,
and confirm it is present. A file that does not exist, or whose content does not
match the cited evidence, is a FAIL.`,

  'regression-red-when-neutered': `## Lens: regression-red-when-neutered
Locate the named regression test that guards this criterion. Obtain the change
it asserts (the behavior being tested) and neuter that behavior in a scratch copy
(revert it, stub it, or disable it). Re-run the test. If the test goes RED under
neutering, the guard is live (PASS). If the test stays GREEN despite the neutering,
the guard is dead — the test is not actually checking the claimed behavior (FAIL).`,

  'holds-at-head': `## Lens: holds-at-head
Re-check the claim at the current HEAD commit, not pinned to the verifiedAtSha.
The criterion may have been true at the pinned sha but no longer true now. If the
claim still holds at HEAD, that is PASS. If the claim has been reverted, broken,
or superseded at HEAD, that is FAIL.`,
};

/** Build the verify prompt for a single lens.
 *  Composes: lens-specific instructions + shared evidence block + verdict trailer.
 *  The evidence block is built once per call and is byte-identical across all three lenses. */
export function buildLensVerifyPrompt(lens: VerifyLens, ctx: LensVerifyCtx): string {
  const evidenceBlock = buildLensEvidenceBlock(ctx);
  const instructions = LENS_INSTRUCTIONS[lens];

  return `${instructions}

${evidenceBlock}

## Your verdict
Respond with EXACTLY one line:
- VERDICT: PASS (if the evidence and claim meet your lens)
- VERDICT: FAIL — <reason> (if not, explain briefly why)`;
}

/** Join panel verdicts using strict-majority vote: met = countMet * 2 > verdicts.length.
 *  Empty input ⇒ fail-closed { met: false, split: true }.
 *  Unanimous met ⇒ { met: true }.
 *  Any non-met lens ⇒ { met: false, split: true, dissent: "<lens1>: <reason1>; <lens2>: <reason2>" }. */
export function joinPanelVerdicts(verdicts: PanelVerdict[]): PanelJoin {
  if (verdicts.length === 0) {
    return { met: false, split: true, dissent: 'no verdicts received' };
  }

  const metCount = verdicts.filter(v => v.met).length;
  const isMet = metCount * 2 > verdicts.length;

  if (isMet) {
    return { met: true };
  }

  const dissentParts = verdicts
    .filter(v => !v.met)
    .map(v => `${v.lens}: ${v.reason}`);
  const dissent = dissentParts.join('; ');

  return { met: false, split: true, dissent };
}
