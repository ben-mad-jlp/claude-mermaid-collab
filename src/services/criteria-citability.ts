/**
 * criteria-citability.ts — the L4 blueprint-time criterion validation gate.
 *
 * A blueprint's acceptance criteria must be citable in the declared change-set.
 * A criterion is NOT citable if it asserts a command's result, an absence, or a
 * code location outside the diff. This module validates BEFORE the implement node
 * is spawned — the same predicate as the terminal G3 grounding gate (validateReviewGrounding),
 * evaluated against the blueprint's DECLARED change-set instead of the realised diff.
 *
 * Pure, no I/O, no spawn. Mirrors review-citations.ts's posture exactly.
 */

import { extractCitations, citationResolves } from './review-citations';
import { ABSENCE_RESULT } from './node-commands';

export type UncitableKind = 'command-result' | 'absence' | 'out-of-diff-location';

export interface CriteriaCitabilityOpts {
  testOnly?: boolean;
  citationExistsAtBase?: (path: string, line: number) => boolean;
}

export interface CriterionVerdict {
  text: string;
  citable: boolean;
  kind?: UncitableKind;
  reason?: string;
}

export interface CriteriaCitability {
  status: 'ok' | 'uncitable' | 'abstain';
  verdicts: CriterionVerdict[];
  offenders: CriterionVerdict[];
  reasons: string[];
}

const MAX_NAMED_OFFENDERS = 3;

/** Line-scan for a heading matching /^#{1,6}\s*acceptance\s+criteri/i; collect
 *  subsequent list items until the next # heading or EOF. Skip fenced code blocks
 *  so the trailing json manifest never parses as criteria. */
export function parseBlueprintCriteria(blueprintMd: string): string[] {
  const criteria: string[] = [];
  let inCodeFence = false;
  let inCriteria = false;

  for (const line of blueprintMd.split('\n')) {
    // Toggle code fence state
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    // Skip everything inside code fences
    if (inCodeFence) continue;

    // Check for acceptance criteria heading
    if (/^#{1,6}\s*acceptance\s+criteri/i.test(line)) {
      inCriteria = true;
      continue;
    }

    // Exit criteria section on next heading
    if (inCriteria && /^#+\s/.test(line) && !/^#{1,6}\s*acceptance\s+criteri/i.test(line)) {
      inCriteria = false;
      break;
    }

    // Collect list items in the criteria section
    if (inCriteria) {
      // Accept BOTH bullet (-, *) and ordered (1. / 1)) list markers. Leaf specs write
      // acceptance criteria as NUMBERED lists ("emit exactly these six: 1. … 2. …") and
      // blueprints copy that format; matching only bullets made this validator abstain on
      // every real blueprint (it never convicted a single criterion).
      const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)(?:\s*(?:—|\(cite|— cite).*)?$/);
      if (match) {
        let criterion = match[1].trim();
        // Strip trailing citation tail (— cite file:line or (cite file:line))
        criterion = criterion.replace(/\s*(?:—|\(cite|— cite).*$/, '').trim();
        // Strip leading checkbox [ ]/[x]
        const cleanCriterion = criterion.replace(/^\[[\ xX]\]\s*/, '').trim();
        if (cleanCriterion) {
          criteria.push(cleanCriterion);
        }
      }
    }
  }

  return criteria;
}

/** True if the citation path resolves into the declared change-set: either via exact/suffix
 *  match (citationResolves), or by matching a declared entry containing `*` via Bun.Glob. */
function resolvesIntoDeclaredChangeSet(path: string, declaredFiles: readonly string[]): boolean {
  if (citationResolves(path, declaredFiles)) return true;
  return declaredFiles.some((d) => {
    if (d.includes('*')) {
      try {
        return new Bun.Glob(d).match(path);
      } catch {
        return false; // malformed glob pattern never matches — fail closed, not open
      }
    }
    return false;
  });
}

/** Rule 0 — ACQUIT on a resolving citation (reuses extractCitations from review-citations). */
function acquitOnResolvingCitation(text: string, declaredFiles: readonly string[]): boolean {
  const citations = extractCitations(text);
  if (citations.length === 0) return false;
  return citations.some((c) => resolvesIntoDeclaredChangeSet(c.path, declaredFiles));
}

/** Rule 1 — CONVICT on out-of-diff-location: a citation found but doesn't resolve into
 *  declaredFiles (only if we have a manifest to check against). */
function convictOnOutOfDiffLocation(
  text: string,
  declaredFiles: readonly string[],
  opts?: CriteriaCitabilityOpts,
): { uncitable: boolean; reason?: string } {
  if (declaredFiles.length === 0) {
    // No manifest — abstain on ignorance, never convict
    return { uncitable: false };
  }

  const citations = extractCitations(text);
  if (citations.length === 0) {
    // No citations found — this rule doesn't apply
    return { uncitable: false };
  }

  // We have citations and a manifest; check if ANY resolve
  const anyResolves = citations.some((c) => resolvesIntoDeclaredChangeSet(c.path, declaredFiles));
  if (anyResolves) {
    // At least one citation resolves — acquitted by Rule 0
    return { uncitable: false };
  }

  // When testOnly and citationExistsAtBase are both set, check if any citation resolves at base
  if (opts?.testOnly && opts.citationExistsAtBase) {
    if (citations.some((c) => opts.citationExistsAtBase!(c.path, c.line))) {
      return { uncitable: false };
    }
  }

  // Citations found, none resolve, and we have a manifest
  const raw = citations[0]!.raw;
  const line = citations[0]!.line;
  return {
    uncitable: true,
    reason: `criterion cites "${raw}:${line}", which is not in the leaf's declared change-set${opts?.testOnly ? ' and does not exist at base' : ''}`,
  };
}

/** Rule 2 — CONVICT on command-result: invocation token or result predicate. */
function convictOnCommandResult(text: string): { uncitable: boolean; reason?: string } {
  // Invocation token: npm, npx, bun, pnpm, yarn, make, tsc, vitest, jest, eslint, cargo, go, xcodebuild, swift, xcrun
  if (/(?:^|[\s`(])(?:npm|npx|bun|pnpm|yarn|make|tsc|vitest|jest|eslint|cargo|go|xcodebuild|swift|xcrun)\s+(?:run|test|--noEmit|-b|\S)/.test(text)) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result (a test, build, or lint invocation), which is uncitable",
    };
  }

  // Result predicate: pass/green/clean over a suite/test/build noun, or inverse
  // Match patterns like "tests pass", "build passes", "suite succeeds", "results match master", etc.
  if (
    /\b(suite|tests?|build|typecheck|type-check|compile|gate|lint|ci|results?|files?)\b[^.]{0,40}\b(pass(?:es|ed)?|green|clean|succeed(?:s|ed)?|exits?\s+0|match(?:es)?\s+master)\b/i.test(
      text,
    )
  ) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result, which is uncitable",
    };
  }

  // Inverse: pass/success before the noun
  if (
    /\b(pass(?:es|ed)?|exits?\s+0)\b[^.]{0,20}\b(suite|tests?|build|results?|files?)\b/i.test(text)
  ) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result, which is uncitable",
    };
  }

  return { uncitable: false };
}

/** Rule 3 — CONVICT on absence: structural patterns that assert a negative about code. */
function convictOnAbsence(text: string): { uncitable: boolean; reason?: string } {
  // Leading "No …" pattern
  if (/^\s*no\s+\S/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence (no file touched, no field added), which is uncitable',
    };
  }

  // "no new/other/additional/extra"
  if (/\bno\s+(new|other|additional|extra)\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "(is|are|was|were) not (touch|chang|modif|add|creat|introduc|import)"
  if (/\b(?:is|are|was|were)?\s*not\s+(touch|chang|modif|add|creat|introduc|import)/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "without …ing"
  if (/\bwithout\s+\w+ing\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "unchanged" or "untouched"
  if (/\b(unchanged|untouched)\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  // "no longer", "references nothing", "nothing external", "self-contained"
  if (/\b(?:no longer|references nothing|nothing external|self[-\s]?contained)\b/i.test(text)) {
    return {
      uncitable: true,
      reason: 'criterion asserts an absence, which is uncitable',
    };
  }

  return { uncitable: false };
}

/** True when the criterion names a runnable READ-ONLY verification invocation WITH a real
 *  argument AND asserts a checkable RESULT token. Such a criterion — even an absence-shaped
 *  one ("X no longer appears — grep -c X file returns 0") — is a command-result the
 *  command-evidence gate can honour, so it must be ACQUITTED, not convicted as an absence. */
function namesVerificationCommand(text: string): boolean {
  // (i) a runnable read-only verification invocation WITH a concrete argument
  const hasInvocation =
    /(?:^|[\s`(])(?:git\s+grep|git\s+ls-files|grep|rg)\s+(?:-\S+\s+)*\S/.test(text) ||
    /(?:^|[\s`(])(?:npx\s+tsc|vitest|bun\s+test)\b/.test(text);
  if (!hasInvocation) return false;

  // (ii) an asserted checkable RESULT token
  const hasResult =
    ABSENCE_RESULT.test(text) ||
    /-c\b[^.]*\b0\b/.test(text) ||
    /\b0\s+occurrences\b/i.test(text) ||
    /\bcount\s+is\s+0\b/i.test(text);
  return hasResult;
}

/** A criterion that asserts a positive, readable property of a concrete OUTPUT-ARTIFACT file (a
 *  report/score/data file — .md/.json/.csv/.log/…, NOT source code) is CITABLE: the review reads
 *  that artifact, regardless of which command produced it. This is the measurement/spike shape
 *  ("run the harness → results/report.md contains a ## GATE verdict section"), which is falsifiable
 *  by READING the file — the opposite of the vague "tests pass" prose the command-result rule
 *  exists to reject. Requires a concrete artifact filename, so it can never acquit a suite-wide
 *  pass/green claim; positive-assertion only, so it never masks an absence ("no changes to X.json").
 *  This is what lets the daemon author + pass author-fidelity / measurement criteria autonomously
 *  instead of escalating them to a human. */
export function assertsCitableArtifact(text: string): boolean {
  // A concrete artifact filename with a report/data extension (source-code extensions excluded).
  if (!/\b[\w./-]+\.(?:md|json|jsonl|ndjson|csv|tsv|txt|log|html|svg|xml)\b/i.test(text)) return false;
  // A POSITIVE property of its content/existence — never an absence ("no …", "unchanged").
  if (/\bno\s+\S|\b(unchanged|untouched)\b/i.test(text)) return false;
  return /\b(contains?|shows?|reports?|records?|lists?|includes?|exists?|written|produced?|generated?|has\s+(?:a|an|the)\b|with\s+(?:a|an|the)\b|section|field|column|row|entry|line|value)\b/i.test(text);
}

/** Classify a single criterion: Rule 0 (acquit-first), then Rules 1–3. */
export function classifyCriterion(
  text: string,
  declaredFiles: readonly string[],
  opts?: CriteriaCitabilityOpts,
): CriterionVerdict {
  // Rule 0: ACQUIT on a resolving citation
  if (acquitOnResolvingCitation(text, declaredFiles)) {
    return { text, citable: true };
  }

  // Rule 0.5: ACQUIT on a concrete output-ARTIFACT content assertion (report.md contains a ## GATE
  // verdict). A produced artifact is citable-by-reading even though it's a runtime output not in the
  // code change-set, so this must precede the out-of-diff conviction. Reuse the 'command-result'
  // kind so the review-time defer predicate honours it too.
  if (assertsCitableArtifact(text)) {
    return { text, citable: true, kind: 'command-result' };
  }

  // Rule 1: CONVICT on out-of-diff-location
  const rule1 = convictOnOutOfDiffLocation(text, declaredFiles, opts);
  if (rule1.uncitable) {
    return { text, citable: false, kind: 'out-of-diff-location', reason: rule1.reason };
  }

  // Rule 1.5: ACQUIT on a named runnable read-only verification command with a checkable result.
  // Reuse the 'command-result' kind so the review-time defer predicate accepts it too.
  if (namesVerificationCommand(text)) {
    return { text, citable: true, kind: 'command-result' };
  }

  // Rule 2: CONVICT on command-result
  const rule2 = convictOnCommandResult(text);
  if (rule2.uncitable) {
    return { text, citable: false, kind: 'command-result', reason: rule2.reason };
  }

  // Rule 3: CONVICT on absence
  const rule3 = convictOnAbsence(text);
  if (rule3.uncitable) {
    return { text, citable: false, kind: 'absence', reason: rule3.reason };
  }

  // Default: CITABLE (no citation required, no command asserted, no absence claimed)
  return { text, citable: true };
}

/** Validate the blueprint's acceptance criteria against the declared change-set. */
export function validateCriteriaCitability(
  blueprintMd: string,
  declaredFiles: readonly string[],
  opts?: CriteriaCitabilityOpts,
): CriteriaCitability {
  const criteria = parseBlueprintCriteria(blueprintMd);

  if (criteria.length === 0) {
    // No criteria section found — we abstain (a doc-only leaf is fine)
    return { status: 'abstain', verdicts: [], offenders: [], reasons: [] };
  }

  const verdicts = criteria.map((c) => classifyCriterion(c, declaredFiles, opts));
  const offenders = verdicts.filter((v) => !v.citable);

  if (offenders.length === 0) {
    // All criteria are citable
    return { status: 'ok', verdicts, offenders, reasons: [] };
  }

  // At least one offender — extract reasons
  const reasons: string[] = offenders
    .slice(0, MAX_NAMED_OFFENDERS)
    .map((o) => `criterion "${o.text.slice(0, 60)}"${o.reason ? ': ' + o.reason : ''}`);

  const rest = offenders.length - MAX_NAMED_OFFENDERS;
  if (rest > 0) {
    reasons.push(`and ${rest} more uncitable criterion(criteria)`);
  }

  return { status: 'uncitable', verdicts, offenders, reasons };
}

/** DEFER-TO-EVIDENCE predicate (floor-path fix). An uncited PASS-criterion set is NOT
 *  review-vacuous when EVERY uncited criterion is a structural COMMAND-RESULT. Those name a
 *  command (tsc/test/build/lint/grep) that the command-evidence gate verifies against the
 *  RECORDED exit codes — they cannot be cited to a diff line, so grounding must defer them to
 *  that gate rather than discard a correct leaf. ABSENCE / non-goal criteria are deliberately
 *  NOT deferred here: no recorded command verifies a negative, so the reviewer must mark those
 *  `[N/A]` (a judgment the classifier must not make — "No regression in auth" is a real check). */
export function uncitedCriteriaAreAllCommandResults(
  criteria: ReadonlyArray<{ text: string; outcome: string; citations: ReadonlyArray<unknown> }>,
  declaredFiles: readonly string[],
): boolean {
  const uncited = criteria.filter((c) => c.outcome !== 'not-applicable' && c.citations.length === 0);
  if (uncited.length === 0) return false;
  return uncited.every((c) => classifyCriterion(c.text, declaredFiles).kind === 'command-result');
}
