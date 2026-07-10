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

export type UncitableKind = 'command-result' | 'absence' | 'out-of-diff-location';

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

/** Rule 0 — ACQUIT on a resolving citation (reuses extractCitations from review-citations). */
function acquitOnResolvingCitation(text: string, declaredFiles: readonly string[]): boolean {
  const citations = extractCitations(text);
  if (citations.length === 0) return false;
  return citations.some((c) => citationResolves(c.path, declaredFiles));
}

/** Rule 1 — CONVICT on out-of-diff-location: a citation found but doesn't resolve into
 *  declaredFiles (only if we have a manifest to check against). */
function convictOnOutOfDiffLocation(
  text: string,
  declaredFiles: readonly string[],
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
  const anyResolves = citations.some((c) => citationResolves(c.path, declaredFiles));
  if (anyResolves) {
    // At least one citation resolves — acquitted by Rule 0
    return { uncitable: false };
  }

  // Citations found, none resolve, and we have a manifest
  const raw = citations[0]!.raw;
  const line = citations[0]!.line;
  return {
    uncitable: true,
    reason: `criterion cites "${raw}:${line}", which is not in the leaf's declared change-set`,
  };
}

/** Rule 2 — CONVICT on command-result: invocation token or result predicate. */
function convictOnCommandResult(text: string): { uncitable: boolean; reason?: string } {
  // Invocation token: npm, npx, bun, pnpm, yarn, make, tsc, vitest, jest, eslint, cargo, go
  if (/(?:^|[\s`(])(?:npm|npx|bun|pnpm|yarn|make|tsc|vitest|jest|eslint|cargo|go)\s+(?:run|test|--noEmit|-b|\S)/.test(text)) {
    return {
      uncitable: true,
      reason: "criterion asserts a command's result (a test, build, or lint invocation), which is uncitable",
    };
  }

  // Result predicate: pass/green/clean over a suite/test/build noun, or inverse
  // Match patterns like "tests pass", "build passes", "suite succeeds", "results match master", etc.
  if (
    /\b(suite|tests?|build|typecheck|type-check|compile|gate|lint|ci|results?|files?)\b[^.]{0,40}\b(pass(?:es|ed)?|green|clean|succeed(?:s)?|exits?\s+0|match(?:es)?\s+master)\b/i.test(
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

  return { uncitable: false };
}

/** Classify a single criterion: Rule 0 (acquit-first), then Rules 1–3. */
export function classifyCriterion(
  text: string,
  declaredFiles: readonly string[],
): CriterionVerdict {
  // Rule 0: ACQUIT on a resolving citation
  if (acquitOnResolvingCitation(text, declaredFiles)) {
    return { text, citable: true };
  }

  // Rule 1: CONVICT on out-of-diff-location
  const rule1 = convictOnOutOfDiffLocation(text, declaredFiles);
  if (rule1.uncitable) {
    return { text, citable: false, kind: 'out-of-diff-location', reason: rule1.reason };
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
): CriteriaCitability {
  const criteria = parseBlueprintCriteria(blueprintMd);

  if (criteria.length === 0) {
    // No criteria section found — we abstain (a doc-only leaf is fine)
    return { status: 'abstain', verdicts: [], offenders: [], reasons: [] };
  }

  const verdicts = criteria.map((c) => classifyCriterion(c, declaredFiles));
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
