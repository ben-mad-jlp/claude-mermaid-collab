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
  /** True when this citation came from a `<path> (deleted)` phrase, not a `:line` cite. */
  deleted?: boolean;
}

export interface CriterionResult {
  outcome: CriterionOutcome;
  /** The criterion text as written, sans the `[MET]` marker and the citation tail. */
  text: string;
  citations: Citation[];
}

export interface ReviewGrounding {
  /** 'ok'      — structure present AND grounding holds (see the rules on validateReviewGrounding).
   *  'vacuous' — no per-criterion results, or a criterion whose citations resolve nowhere
   *              (neither change-set nor worktree), or a MET/UNMET criterion with no citation
   *              at all, or (non-empty diff) a review with zero change-set contact.
   *  'abstain' — the change-set was unreadable/unwired: we CANNOT validate grounding, so
   *              we do not pretend to. Caller treats it as today's behaviour (no park). */
  status: 'ok' | 'vacuous' | 'abstain';
  /** One-line human reasons, most specific first. The offending citation is NAMED. */
  reasons: string[];
  criteria: CriterionResult[];
  /** True when the change-set was EMPTY (readable, zero files — a retained-work leaf whose
   *  edits are already carried by the epic base after claim churn) and citations were
   *  validated against the WORKTREE instead. Surfaced for observability: watch the rate. */
  retainedMode?: boolean;
}

export interface GroundingOpts {
  /** Does `path` exist under the lane worktree with at least `line` lines? Injected by the
   *  caller (this module stays I/O-free). Used to tolerate RETAINED-CODE citations: a
   *  criterion legitimately satisfied by code the leaf did not change cites a real
   *  worktree location outside the change-set. Absent → no worktree fallback (strict). */
  citationExists?: (path: string, line: number) => boolean;
}

const CRITERION_RE = /^\s*[-*]?\s*\[\s*(MET|UNMET|N\/?A|NOT[-_ ]?APPLICABLE)\s*\]\s*(.+?)\s*$/i;

// A list line: leading `-`/`*` or `<n>.`/`<n>)` bullet, capturing the remaining content.
const LIST_LINE_RE = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/;
// A bracketed outcome marker anywhere in a string (non-global: we use `.index`).
const OUTCOME_MARKER_RE = /\[\s*(MET|UNMET|N\/?A|NOT[-_ ]?APPLICABLE)\s*\]/i;

// The filename must look like a real file so prose like "step 3:12" never matches:
// either it carries an extension (name.ext) OR it is a leading-dot dotfile (.gitignore,
// .env). This covers TOP-LEVEL files with no slash — e.g. `.gitignore:43`, `package.json:12`
// — which a slash-only path would miss (that miss false-blocks reviews as "vacuous").
// Accepts a `:12-40` range (uses the start line). Anchors on a preceding boundary.
const CITATION_RE = /(?:^|[\s(`'"[,])((?:\.\/)?(?:[\w.@-]+\/)*(?:[\w.@-]*\.[A-Za-z0-9]+|\.[A-Za-z][\w.-]*)):(\d+)(?:-\d+)?/g;

// A deletion citation: `<path> (deleted)` — a criterion whose evidence is a file the
// change-set REMOVES has no file:line to cite (the file no longer exists). Accept the
// `(deleted)` phrase as the citation itself; grounding still requires the path to appear
// in the change-set (see validateReviewGrounding) — an un-deleted path still fails.
const DELETION_CITE_RE =
  /(?:^|[\s(`'"[,])((?:\.\/)?(?:[\w.@-]+\/)*(?:[\w.@-]*\.[A-Za-z0-9]+|\.[A-Za-z][\w.-]*))\s*\(\s*deleted\s*\)/gi;

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
  DELETION_CITE_RE.lastIndex = 0;
  while ((m = DELETION_CITE_RE.exec(line)) !== null) {
    const raw = m[1];
    out.push({ raw, path: normalizeCitedPath(raw), line: 0, deleted: true });
  }
  return out;
}

/** Line-scan the review text for `- [MET] <criterion> — <path>:<line>` style lines.
 *  Deliberately does NOT strip markdown formatting before extracting citations —
 *  `stripSentinelFmt` deletes `_` and would corrupt real filenames. */
export function parseCriterionResults(text: string): CriterionResult[] {
  const results: CriterionResult[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    let outcome: CriterionOutcome | null = null;
    let body: string | null = null;

    // (a) Marker-first (existing, unchanged): `- [MET] <text> — <path>:<line>`.
    const markerFirst = rawLine.match(CRITERION_RE);
    if (markerFirst) {
      outcome = outcomeFromMarker(markerFirst[1]);
      body = markerFirst[2];
    } else {
      // (b) List-anchored: a `-`/`*`/`<n>.` line whose marker sits ANYWHERE, e.g.
      //     `1. <criterion> — [MET] <path>:<line>` (H4's real shape).
      const list = rawLine.match(LIST_LINE_RE);
      if (list) {
        const marker = list[1].match(OUTCOME_MARKER_RE);
        if (marker) {
          outcome = outcomeFromMarker(marker[1]);
          body = list[1].slice(0, marker.index); // criterion text sits before the marker
        }
      }
    }
    if (outcome === null || body === null) continue;

    let citations = extractCitations(rawLine);
    // (c) TWO-LINE format (8dbbdc8d): the criterion + citation on one line, the bare
    //     marker alone on the NEXT (`1. <text> — <path>:<line>` \n `   - [MET]`).
    //     A bare-marker line (no text, no citations) adopts the PRECEDING line's
    //     text + citations instead of parsing as an empty criterion that "cites nothing".
    if (body.trim() === '' && citations.length === 0 && i > 0) {
      const prev = lines[i - 1];
      const prevCites = extractCitations(prev);
      if (prevCites.length > 0) {
        citations = prevCites;
        const prevList = prev.match(LIST_LINE_RE);
        body = prevList ? prevList[1] : prev;
      }
    }
    // Cut the criterion text at an em/en-dash separator if present.
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
 *  to know that — it only maps (text, changeSet, opts) → ok/vacuous/abstain.
 *
 *  Grounding rules (per Grok-consulted design, decision review-grounding-retained-mode):
 *  1. Unreadable change-set (null) → abstain (unchanged).
 *  2. Every non-N/A criterion must cite something (unchanged).
 *  3. Per-criterion: a non-N/A criterion is grounded iff ≥1 citation resolves into the
 *     change-set, OR — the RETAINED-CODE tolerance — ≥1 citation resolves to a real
 *     worktree file:line via opts.citationExists. Criteria satisfied by code the leaf
 *     deliberately did not change cite real locations outside the change-set; fabricated
 *     paths/lines still fail both checks and stay offenders. A '<path> (deleted)' citation
 *     grounds the same way — via change-set membership of the deleted path, never by
 *     opts.citationExists (the file no longer exists to read).
 *  4. Change-set FLOOR: when the change-set is NON-empty, ≥1 citation across the whole
 *     review must resolve into it — proof the reviewer touched the actual delta. Worktree
 *     tolerance never substitutes for all change-set contact.
 *  5. RETAINED MODE: an EMPTY (readable) change-set — a retained-work leaf whose edits are
 *     already carried by the epic base after claim churn (85058e61) — skips the floor and
 *     validates every criterion against the worktree only. Flagged via retainedMode. */
export function validateReviewGrounding(
  text: string,
  changeSet: readonly string[] | null,
  opts?: GroundingOpts,
): ReviewGrounding {
  if (changeSet === null) {
    return { status: 'abstain', reasons: ['review-grounding: change-set unreadable'], criteria: [] };
  }
  const retainedMode = changeSet.length === 0;
  const exists = opts?.citationExists;

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

  // Per-criterion grounding (rule 3). Extra unresolvable citations on an already-grounded
  // criterion are TOLERATED. A criterion whose citations ALL fail both checks is the offender.
  const offenders: Citation[] = [];
  for (const c of criteria) {
    if (c.outcome === 'not-applicable') continue; // N/A citations are tolerated, never offenders
    const grounded =
      c.citations.some((cite) => citationResolves(cite.path, changeSet)) ||
      (exists != null && c.citations.some((cite) => exists(cite.path, cite.line)));
    if (!grounded) offenders.push(...c.citations);
  }
  if (offenders.length > 0) {
    const named = offenders.slice(0, MAX_NAMED_OFFENDERS).map((o) => `${o.raw}:${o.line}`);
    const rest = offenders.length - named.length;
    const reasons = named.map((n) =>
      `review: citation "${n}" is not in the change-set${exists != null ? ' and does not resolve in the worktree' : ''}`);
    if (rest > 0) reasons.push(`review: ${rest} more offending citation(s)`);
    return { status: 'vacuous', reasons, criteria, retainedMode };
  }

  const totalCitations = criteria.reduce((n, c) => n + c.citations.length, 0);
  if (totalCitations === 0) {
    // Reachable only when every criterion is N/A — an all-N/A PASS reviewed nothing.
    return {
      status: 'vacuous',
      reasons: ['review: findings cite nothing in the change-set'],
      criteria,
      retainedMode,
    };
  }

  // Change-set floor (rule 4): tolerating retained-code criteria must not let a review
  // pass with ZERO contact with the delta. Only applies when there IS a delta.
  if (!retainedMode) {
    const touchedDelta = criteria.some((c) =>
      c.citations.some((cite) => citationResolves(cite.path, changeSet)));
    if (!touchedDelta) {
      return {
        status: 'vacuous',
        reasons: ['review: no citation resolves into the change-set (review never touched the delta)'],
        criteria,
        retainedMode,
      };
    }
  }

  return {
    status: 'ok',
    reasons: retainedMode
      ? ['review-grounding: retained mode (empty change-set; citations validated against the worktree)']
      : [],
    criteria,
    retainedMode,
  };
}

/** Canonical-UUID-shaped token, boundary-anchored so it never matches mid-word. This is the
 *  exact shape Payload C injects for a constraint id (`- <uuid>: <title>`), so a review that
 *  cites a constraint echoes this shape. */
const CONSTRAINT_ID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Two ids match if equal (case-insensitive) OR share a leading-8-hex short id (the
 *  repo-wide short-id convention). */
function constraintIdMatches(cited: string, active: string): boolean {
  const a = cited.toLowerCase();
  const b = active.toLowerCase();
  return a === b || a.slice(0, 8) === b.slice(0, 8);
}

export interface ConstraintCiteCheck {
  /** Constraint-id-shaped tokens in the review that match NO active constraint id. Advisory. */
  fabricated: string[];
}

/**
 * ADVISORY cite-check (never a gate). Extract constraint-id-shaped tokens from `reviewText`
 * and return those that correspond to no existing ACTIVE constraint id. A review that cites
 * nothing constraint-shaped ⇒ empty `fabricated` (NOT a finding). Pure: no I/O, no verdict.
 * Callers surface the result as a logged/recorded note ONLY — it must never feed a pass/fail.
 */
export function checkConstraintCitations(
  reviewText: string,
  activeConstraintIds: readonly string[],
): ConstraintCiteCheck {
  CONSTRAINT_ID_RE.lastIndex = 0;
  const fabricated: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = CONSTRAINT_ID_RE.exec(reviewText)) !== null) {
    const token = m[0];
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!activeConstraintIds.some((id) => constraintIdMatches(token, id))) {
      fabricated.push(token);
    }
  }
  return { fabricated };
}
