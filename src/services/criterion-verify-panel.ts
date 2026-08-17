/** Distinct-lens verification panel for mission criteria.
 *  A criterion truth is verified by three independent lenses, each asking a specific question,
 *  then joined by strict-majority vote. Verdicts are deterministic, LLM-free. */

import { coerceArrayArg } from '../mcp/arg-coercion.js';
import { isTransientNodeFault } from '../agent/node-invoker.js';

export interface AssertionFact {
  name: string;
  path: string | null;
  caller: string | null;
}

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
  /** Set when the lens produced no usable vote because its node hit provider infra. */
  indeterminate?: boolean;
}

export interface PanelJoin {
  met: boolean;
  split?: boolean;
  dissent?: string;
  /** Set when every supplied verdict was indeterminate. */
  indeterminate?: boolean;
}

/** Strip markdown formatting characters that can obscure VERDICT lines.
 *  Mirrors stripSentinelFmt in leaf-executor.ts:1669 for local fail-closed parsing. */
function stripSentinelFmt(text: string): string {
  return text.replace(/[`*_"']/g, '');
}

/** Parse assertion names from criterion text under any caller spelling.
 *  Matches it/test/describe with optional .only/.skip/.todo/.failing/.concurrent/.each modifiers,
 *  any whitespace before the opening paren, and any quote style (' " `).
 *  Handles .each() which may be followed by another call.
 *  Returns de-duplicated names in source order. */
export function parseNamedAssertions(criterionText: string): string[] {
  // Allow optional (...) arguments between modifiers and the quoted name
  // This handles cases like describe.each(['a'])('X') where .each() is followed by ('X')
  const pattern = /\b(?:it|test|describe)(?:\.(?:only|skip|todo|failing|concurrent|each))*(?:\s*\([^)]*\))*\s*\(\s*(['"`])([^'"`]+)\1/g;
  const names: string[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = pattern.exec(criterionText)) !== null) {
    const name = match[2];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

/** Find the caller identifier (it/test/describe) that declares the given assertion name in file text.
 *  Returns the caller string, or null if not found. The name is regex-escaped and quote-anchored
 *  so 'X' does not match 'Xtra'. Handles modifiers like .each() that may be followed by another call. */
export function declaringCallerIn(fileText: string, name: string): string | null {
  // Regex-escape the name to prevent special chars from being interpreted
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match any caller with modifiers and any quote style, with the name anchored by the closing quote.
  // Allow optional (...) arguments between modifiers and the quoted name.
  const pattern = new RegExp(
    `\\b(it|test|describe)(?:\\.(?:only|skip|todo|failing|concurrent|each))*(?:\\s*\\([^)]*\\))*\\s*\\(\\s*(['"\`])${escapedName}\\2`,
    'g'
  );

  const match = pattern.exec(fileText);
  return match ? match[1] : null;
}

/** Boolean predicate: is the given assertion name declared in the file text under any caller? */
export function assertionDeclaredIn(fileText: string, name: string): boolean {
  return declaringCallerIn(fileText, name) !== null;
}

/** Find which parsed assertion names are missing from all supplied files. */
export function namedAssertionMisses(criterionText: string, files: Array<{ path: string; text: string }>): string[] {
  const parsed = parseNamedAssertions(criterionText);
  return parsed.filter((name) => !files.some((f) => assertionDeclaredIn(f.text, name)));
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

/** Detect provider infra failures (rate limit, quota, overload, timeout, start failure).
 *  Complements RATE_LIMIT_RE at node-invoker.ts:423 to catch subscription-cap sentences. */
export const PANEL_INFRA_TEXT_RE = /you[''']ve reached your .{0,40}limit|quota|rate.?limit|429|overloaded/i;

/** Classify a lens outcome into a usable vote category.
 *  Pure function: no I/O, no clock, no module state. */
export function classifyLensOutcome(input: {
  ok: boolean;
  exitCode?: number;
  timedOut?: boolean;
  rateLimited?: boolean;
  startFailure?: unknown;
  text?: string;
  parsed: 'met' | 'not-met' | 'error';
}): 'met' | 'not-met' | 'infra' {
  // Check for transient node faults first.
  if (isTransientNodeFault({ rateLimited: input.rateLimited, startFailure: input.startFailure, timedOut: input.timedOut } as any)) {
    return 'infra';
  }

  // If the node failed (non-zero exit or !ok) AND parsed as error, it's an infra fault.
  if ((!input.ok || (input.exitCode != null && input.exitCode !== 0)) && input.parsed === 'error') {
    return 'infra';
  }

  // If the text matches infra patterns, it's indeterminate (even if ok:true).
  if (input.text && PANEL_INFRA_TEXT_RE.test(input.text)) {
    return 'infra';
  }

  // Otherwise, use the parsed verdict.
  return input.parsed === 'met' ? 'met' : 'not-met';
}

/** Build the shared evidence block, identical across all three lenses.
 *  Includes criterion text, evidence prose (if any), and file paths.
 *  When assertionFacts is provided, also renders a '## Named assertions' section. */
export function buildLensEvidenceBlock(ctx: LensVerifyCtx, assertionFacts?: AssertionFact[]): string {
  const pathsList = ctx.evidencePaths.length > 0 ? ctx.evidencePaths.join('\n  - ') : 'none';

  let block = `## Criterion
${ctx.criterionText}

## Evidence
${ctx.evidence ?? '(no evidence prose — verdict is pinned to HEAD at ' + ctx.verifiedAtSha + ')'}

## Evidence paths
  - ${pathsList}`;

  if (assertionFacts && assertionFacts.length > 0) {
    const assertionLines = assertionFacts.map((fact) => {
      if (fact.path !== null && fact.caller !== null) {
        return `  - ${fact.name} — declared in ${fact.path} as ${fact.caller}(…)`;
      } else {
        return `  - ${fact.name} — MISSING`;
      }
    }).join('\n');

    block += `

## Named assertions
${assertionLines}`;
  }

  return block;
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
 *  The evidence block is built once per call and is byte-identical across all three lenses.
 *  When assertionFacts is provided, all three lenses receive the same named assertions section. */
export function buildLensVerifyPrompt(lens: VerifyLens, ctx: LensVerifyCtx, assertionFacts?: AssertionFact[]): string {
  const evidenceBlock = buildLensEvidenceBlock(ctx, assertionFacts);
  const instructions = LENS_INSTRUCTIONS[lens];

  return `${instructions}

${evidenceBlock}

## Your verdict
Reply with your reasoning, then end your response with EXACTLY one final line and nothing after it:
- VERDICT: PASS (if the evidence and claim meet your lens)
- VERDICT: FAIL — <reason> (if not, explain briefly why)
Do not wrap the VERDICT line in backticks, quotes, or a code fence.`;
}

/** THE one panel join rule — strict-majority vote: met = countMet * 2 > verdicts.length.
 *  Both doors — the auto-panel runner (criterion-verify-panel-runner.ts) and the tool
 *  boundary (set_mission_criterion in mission-tools.ts) — MUST take their met from this
 *  function and nothing else, so the same verdict array grades identically everywhere.
 *  (The runner used to AND an extra unanimity requirement on top of this result, so a
 *  2-of-3 array graded met:false through the runner but met:true through the tool.)
 *  Indeterminate verdicts (infra faults) are filtered before the majority vote.
 *  Empty input ⇒ fail-closed { met: false, split: true }.
 *  All indeterminate ⇒ { met: false, split: true, indeterminate: true, dissent: '…(infra)' }.
 *  Majority met ⇒ { met: true } (any dissenting lens stays visible in the verdicts array).
 *  Majority not met ⇒ { met: false, split: true, dissent: "<lens1>: <reason1>; <lens2>: <reason2>" }. */
export function joinPanelVerdicts(verdicts: PanelVerdict[]): PanelJoin {
  if (verdicts.length === 0) {
    return { met: false, split: true, dissent: 'no verdicts received' };
  }

  // Filter out indeterminate (infra fault) verdicts before majority computation.
  const effective = verdicts.filter(v => v.indeterminate !== true);

  if (effective.length === 0) {
    return { met: false, split: true, indeterminate: true, dissent: 'all lenses indeterminate (infra)' };
  }

  const metCount = effective.filter(v => v.met).length;
  const isMet = metCount * 2 > effective.length;

  if (isMet) {
    return { met: true };
  }

  const dissentParts = effective
    .filter(v => !v.met)
    .map(v => `${v.lens}: ${v.reason}`);
  const dissent = dissentParts.join('; ');

  return { met: false, split: true, dissent };
}

/** Normalize the `panelVerdicts` argument as it arrives at a tool/route boundary.
 *  Some MCP clients marshal an array-OF-OBJECTS argument as a JSON STRING (array-of-strings
 *  params like evidencePaths pass through as real arrays, so only the nested one is affected).
 *  Left un-coerced, a high-stakes verdict is UNRECORDABLE: a string has `.length` (spuriously
 *  clearing the ≥2 panel gate) and then joinPanelVerdicts calls `.filter` on it and throws
 *  `verdicts.filter is not a function`. Delegates to shared coerceArrayArg for normalization. */
export function normalizePanelVerdicts(raw: unknown): PanelVerdict[] | undefined {
  return coerceArrayArg(raw, 'panelVerdicts') as PanelVerdict[] | undefined;
}
