/**
 * review-citations.ts — the G3 GROUNDING gate.
 *
 * A mechanically-green tree plus a one-line `VERDICT: PASS` accepts today even when the
 * reviewer never opened the code (782052e2). This module demands GROUNDING, not effort:
 * the reviewer must emit a per-criterion result carrying a `file:line` citation, and every
 * citation must resolve into the leaf's own change-set. No token floor, no tool-call floor,
 * no grepping prose for verdict words — that is the bug class under repair.
 *
 * Division of labour: this module validates STRUCTURE (are there per-criterion results)
 * and GROUNDING (do the citations resolve into the change-set). The LLM still judges
 * SEMANTICS (is the criterion actually met) — that is out of scope here by construction.
 *
 * Pure, domain-free, no I/O, no `spawn`. Mirrors leaf-gate.ts's posture: the executor
 * calls it, it decides nothing about semantics.
 */

export type CriterionOutcome = 'met' | 'unmet' | 'not-applicable';

export interface Citation {
  /** The path exactly as the reviewer wrote it (for the offending-citation message). */
  raw: string;
  /** Normalised, repo-relative-ish (leading `./` stripped, backticks/quotes stripped). */
  path: string;
  line: number;
}

export interface CriterionResult {
  outcome: CriterionOutcome;
  /** The criterion text as written, sans the `[MET]` marker and the citation tail. */
  text: string;
  citations: Citation[];
}

export interface ReviewGrounding {
  /** 'ok'      — structure present AND every citation resolves into the change-set.
   *  'vacuous' — no per-criterion results, or a citation that resolves nowhere, or a
   *              MET/UNMET criterion with no citation at all. An INFRA error (G1 sense).
   *  'abstain' — the change-set was unreadable/unwired: we CANNOT validate grounding, so
   *              we do not pretend to. Caller treats it as today's behaviour (no park). */
  status: 'ok' | 'vacuous' | 'abstain';
  /** One-line human reasons, most specific first. The offending citation is NAMED. */
  reasons: string[];
  criteria: CriterionResult[];
}

const CRITERION_RE = /^\s*[-*]?\s*\[\s*(MET|UNMET|N\/?A|NOT[-_ ]?APPLICABLE)\s*\]\s*(.+?)\s*$/i;

// Requires a file extension so prose like "step 3:12" never matches. Accepts a `:12-40`
// range (uses the start line). Anchors on a preceding boundary so it doesn't match mid-word.
const CITATION_RE = /(?:^|[\s(`'"[,])((?:\.\/)?[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z0-9]+):(\d+)(?:-\d+)?/g;

function outcomeFromMarker(marker: string): CriterionOutcome {
  const m = marker.toUpperCase().replace(/[-_ ]/g, '');
  if (m === 'MET') return 'met';
  if (m === 'UNMET') return 'unmet';
  return 'not-applicable'; // N/A, NA, NOTAPPLICABLE
}

/** Strip surrounding backticks/quotes, strip a leading `./`, collapse `\` → `/`. */
function normalizeCitedPath(p: string): string {
  return p.replace(/^[`'"]+|[`'"]+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function extractCitations(line: string): Citation[] {
  const out: Citation[] = [];
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(line)) !== null) {
    const raw = m[1];
    out.push({ raw, path: normalizeCitedPath(raw), line: Number(m[2]) });
  }
  return out;
}

/** Line-scan the review text for `- [MET] <criterion> — <path>:<line>` style lines.
 *  Deliberately does NOT strip markdown formatting before extracting citations —
 *  `stripSentinelFmt` deletes `_` and would corrupt real filenames. */
export function parseCriterionResults(text: string): CriterionResult[] {
  const results: CriterionResult[] = [];
  for (const rawLine of text.split('\n')) {
    const m = rawLine.match(CRITERION_RE);
    if (!m) continue;
    const outcome = outcomeFromMarker(m[1]);
    const citations = extractCitations(rawLine);
    // The criterion text sans the citation tail: cut at the first citation's raw token,
    // or at an em/en-dash separator, whichever comes first.
    let body = m[2];
    const dashIdx = body.search(/\s[—-]\s/);
    if (dashIdx >= 0) body = body.slice(0, dashIdx);
    results.push({ outcome, text: body.trim(), citations });
  }
  return results;
}

/** Segment-anchored so `a/foo.ts` never matches `b/barfoo.ts`. Never stats the
 *  filesystem — the change-set IS the ground truth by definition. */
export function citationResolves(path: string, changeSet: readonly string[]): boolean {
  if (changeSet.includes(path)) return true;
  for (const c of changeSet) {
    if (path.endsWith('/' + c)) return true; // reviewer cited absolute/longer
    if (c.endsWith('/' + path)) return true; // reviewer cited a suffix
  }
  return false;
}

const MAX_NAMED_OFFENDERS = 3;

/** The gate: PASS-only in the caller (executor), but the validator itself doesn't need
 *  to know that — it only maps (text, changeSet) → ok/vacuous/abstain. */
export function validateReviewGrounding(
  text: string,
  changeSet: readonly string[] | null,
): ReviewGrounding {
  if (changeSet === null) {
    return { status: 'abstain', reasons: ['review-grounding: change-set unreadable'], criteria: [] };
  }

  const criteria = parseCriterionResults(text);
  if (criteria.length === 0) {
    return {
      status: 'vacuous',
      reasons: ['review: no per-criterion results (vacuous PASS)'],
      criteria,
    };
  }

  for (const c of criteria) {
    if (c.outcome !== 'not-applicable' && c.citations.length === 0) {
      return {
        status: 'vacuous',
        reasons: [`review: criterion "${c.text.slice(0, 60)}" cites nothing`],
        criteria,
      };
    }
  }

  const offenders: Citation[] = [];
  for (const c of criteria) {
    for (const cite of c.citations) {
      if (!citationResolves(cite.path, changeSet)) offenders.push(cite);
    }
  }
  if (offenders.length > 0) {
    const named = offenders.slice(0, MAX_NAMED_OFFENDERS).map((o) => `${o.raw}:${o.line}`);
    const rest = offenders.length - named.length;
    const reasons = named.map((n) => `review: citation "${n}" is not in the change-set`);
    if (rest > 0) reasons.push(`review: ${rest} more offending citation(s)`);
    return { status: 'vacuous', reasons, criteria };
  }

  const totalCitations = criteria.reduce((n, c) => n + c.citations.length, 0);
  if (totalCitations === 0) {
    // Reachable only when every criterion is N/A — an all-N/A PASS reviewed nothing.
    return {
      status: 'vacuous',
      reasons: ['review: findings cite nothing in the change-set'],
      criteria,
    };
  }

  return { status: 'ok', reasons: [], criteria };
}
