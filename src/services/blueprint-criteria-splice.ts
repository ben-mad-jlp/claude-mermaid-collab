/**
 * blueprint-criteria-splice.ts — DISPOSITION-ROUTED criteria repair (pure, no I/O, no spawn).
 *
 * When the L4 citability gate (criteria-citability.ts) rules a blueprint's acceptance criteria
 * `uncitable`, the historical repair re-prompted the blueprint node with the ENTIRE blueprint and
 * asked for a full re-author — measured at ~138s of opus / ~11.7k output tokens / ~523k cache
 * reads to fix ONE sentence, firing on ~15.7% of all blueprint evaluations.
 *
 * The verdict already carries the KIND of each offence, and the two common kinds want opposite
 * treatments:
 *
 *   command-result       → DELETE. "`foo.test.ts` passes" restates what the mechanical gate
 *                          already runs and already fails the leaf on. Removing the line removes
 *                          no coverage, and costs ZERO nodes.
 *   absence /            → TARGETED REWRITE. "src/foo.ts no longer imports bar" encodes REAL work
 *   out-of-diff-location   nothing else enforces; deleting it would let a leaf go green without
 *                          doing the removal. One node, asked for ONLY the replacement sentence.
 *
 * Either way the edit is a LINE SPLICE: every other criterion and every other byte of the
 * blueprint (prose, headings, the trailing json manifest/contract fence) stays identical.
 *
 * FLOOR GUARD: if the deletions would leave ZERO acceptance criteria, nothing is applied. A leaf
 * with no criteria is vacuous — it proves nothing and passes everything — so that is a SPEC
 * DEFECT for a human, never an automatic repair.
 *
 * The criteria scanner here MIRRORS parseBlueprintCriteria (criteria-citability.ts:42) exactly:
 * same fence toggling, same heading detection, same list-marker regex, same tail/checkbox
 * stripping. It differs only in ALSO returning each criterion's line index, which is what makes
 * the splice possible. `scanCriteriaLines(md).map(c => c.text)` must equal
 * `parseBlueprintCriteria(md)` for every input — asserted directly in the tests.
 */

import { compliantShapeFor, type UncitableKind } from './criteria-citability';
import type { CriterionRewriteRequest } from './leaf-prompts';

/** One acceptance-criterion line: its 0-based index in the blueprint's line array, the RAW line,
 *  and the PARSED criterion text (identical to what parseBlueprintCriteria would yield). */
export interface ScannedCriterion {
  lineIndex: number;
  raw: string;
  text: string;
}

/** An offender as the citability verdict carries it (CriterionVerdict, structurally). */
export interface OffendingCriterion {
  text: string;
  kind?: UncitableKind;
  reason?: string;
}

export type CriterionAction = 'delete' | 'rewrite';

/** How one uncitable KIND is disposed of. command-result is redundant with the mechanical gate
 *  ⇒ delete. Everything else encodes work nothing else enforces ⇒ rewrite. An UNKNOWN/absent kind
 *  is conservative: rewrite (never delete a criterion we could not classify). */
export function actionForKind(kind: UncitableKind | undefined): CriterionAction {
  return kind === 'command-result' ? 'delete' : 'rewrite';
}

export interface DispositionPlan {
  /** Offenders to splice OUT of the blueprint. Zero nodes. */
  deletes: OffendingCriterion[];
  /** Offenders that need one targeted rewrite node. */
  rewrites: OffendingCriterion[];
  /** How many acceptance criteria the blueprint has in total. */
  totalCriteria: number;
  /** How many would survive the deletions. */
  remaining: number;
  /** TRUE when applying the plan would leave ZERO criteria ⇒ spec defect, apply NOTHING. */
  vacuous: boolean;
}

/** Line-scan for the acceptance-criteria section, returning each criterion WITH its line index.
 *  Mirrors parseBlueprintCriteria (criteria-citability.ts:42) rule-for-rule. */
export function scanCriteriaLines(blueprintMd: string): ScannedCriterion[] {
  const out: ScannedCriterion[] = [];
  const lines = blueprintMd.split('\n');
  let inCodeFence = false;
  let inCriteria = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (/^#{1,6}\s*acceptance\s+criteri/i.test(line)) {
      inCriteria = true;
      continue;
    }
    if (inCriteria && /^#+\s/.test(line) && !/^#{1,6}\s*acceptance\s+criteri/i.test(line)) {
      inCriteria = false;
      break;
    }

    if (inCriteria) {
      const match = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)(?:\s*(?:—|\(cite|— cite).*)?$/);
      if (match) {
        let criterion = match[1]!.trim();
        criterion = criterion.replace(/\s*(?:—|\(cite|— cite).*$/, '').trim();
        const cleanCriterion = criterion.replace(/^\[[\ xX]\]\s*/, '').trim();
        if (cleanCriterion) {
          out.push({ lineIndex: i, raw: line, text: cleanCriterion });
        }
      }
    }
  }

  return out;
}

/** Route each offender by its kind and apply the FLOOR GUARD. Offenders whose text matches no
 *  criterion line (a verdict for a blueprint we can no longer find the line in) are dropped from
 *  both buckets — we never splice what we cannot locate. */
export function planCriteriaDispositions(
  blueprintMd: string,
  offenders: readonly OffendingCriterion[],
): DispositionPlan {
  const scanned = scanCriteriaLines(blueprintMd);
  const present = new Set(scanned.map((c) => c.text));

  const deletes: OffendingCriterion[] = [];
  const rewrites: OffendingCriterion[] = [];
  for (const o of offenders) {
    if (!present.has(o.text.trim())) continue;
    (actionForKind(o.kind) === 'delete' ? deletes : rewrites).push(o);
  }

  // Distinct criterion TEXTS being deleted — a duplicated criterion line is one criterion for
  // floor-guard purposes only in the sense that every copy of it goes.
  const deletedTexts = new Set(deletes.map((o) => o.text.trim()));
  const survivors = scanned.filter((c) => !deletedTexts.has(c.text)).length;

  return {
    deletes,
    rewrites,
    totalCriteria: scanned.length,
    remaining: survivors,
    vacuous: scanned.length > 0 && survivors === 0,
  };
}

export interface CriteriaSpliceInput {
  /** Criterion TEXTS whose lines are removed entirely. */
  deletes: readonly string[];
  /** Criterion TEXTS whose line body is replaced with `replacement`. */
  rewrites: ReadonlyArray<{ text: string; replacement: string }>;
}

export interface CriteriaSpliceResult {
  md: string;
  changed: boolean;
  deleted: number;
  rewritten: number;
}

/** Apply the plan as a LINE SPLICE. Deleted lines are removed; rewritten lines keep their exact
 *  indent, list marker and checkbox and swap only the criterion body. Every other byte of the
 *  document — including the trailing json fence — is untouched. A delete wins over a rewrite for
 *  the same text (a caller should never ask for both). */
export function applyCriteriaDispositions(
  blueprintMd: string,
  input: CriteriaSpliceInput,
): CriteriaSpliceResult {
  const deleteSet = new Set(input.deletes.map((t) => t.trim()));
  const rewriteMap = new Map<string, string>();
  for (const r of input.rewrites) {
    const key = r.text.trim();
    if (deleteSet.has(key)) continue;
    if (r.replacement.trim()) rewriteMap.set(key, r.replacement.trim());
  }
  if (deleteSet.size === 0 && rewriteMap.size === 0) {
    return { md: blueprintMd, changed: false, deleted: 0, rewritten: 0 };
  }

  const scanned = scanCriteriaLines(blueprintMd);
  const lines = blueprintMd.split('\n');
  const drop = new Set<number>();
  let deleted = 0;
  let rewritten = 0;

  for (const c of scanned) {
    if (deleteSet.has(c.text)) {
      drop.add(c.lineIndex);
      deleted += 1;
      continue;
    }
    const replacement = rewriteMap.get(c.text);
    if (replacement) {
      // Preserve leading whitespace + list marker + optional checkbox; replace the body only.
      const prefix = c.raw.match(/^\s*(?:[-*]|\d+[.)])\s+(?:\[[\ xX]\]\s*)?/)?.[0] ?? '- ';
      lines[c.lineIndex] = `${prefix}${replacement}`;
      rewritten += 1;
    }
  }

  const md = lines.filter((_, i) => !drop.has(i)).join('\n');
  return { md, changed: deleted > 0 || rewritten > 0, deleted, rewritten };
}

/** Parse the targeted-rewrite node's reply: one `<n>) <replacement text>` line per offender, in
 *  the order they were asked. Tolerates `1.`/`1)`/`1:` and a stray bullet or checkbox after the
 *  number. Returns a 1-based ordinal → replacement map holding ONLY ordinals in [1, count]; the
 *  FIRST line for an ordinal wins, so an echoed preamble cannot overwrite a real answer.
 *  Anything unparsed is simply absent — that criterion keeps its original text and the leaf parks
 *  exactly as it does today. */
export function parseCriterionReplacements(replyText: string, count: number): Map<number, string> {
  const out = new Map<number, string>();
  if (count <= 0) return out;
  for (const line of replyText.split('\n')) {
    const m = line.match(/^\s*(\d{1,3})\s*[).:]\s*(.+?)\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > count || out.has(n)) continue;
    const body = m[2]!.replace(/^(?:[-*]\s+)?(?:\[[\ xX]\]\s*)?/, '').trim();
    if (body) out.set(n, body);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Call-site helpers. These live here (not in leaf-executor.ts) so the executor's citability
// branch stays a ~30-line orchestration of node-spend decisions: plan → maybe ONE node → splice.
// ─────────────────────────────────────────────────────────────────────────────

/** The offenders that need a node, shaped for buildCriterionRewritePrompt: the offending text,
 *  the gate's reason, and the compliant shape the gate itself renders (compliantShapeFor). */
export function rewriteRequests(plan: DispositionPlan): CriterionRewriteRequest[] {
  return plan.rewrites.map((o) => ({
    text: o.text,
    reason: o.reason,
    shape: o.kind ? compliantShapeFor(o.kind, o.text) : undefined,
  }));
}

/** The FLOOR-GUARD park reason. Keeps the `blueprint-uncitable-criterion` prefix every downstream
 *  reader and telemetry query already matches on, and says plainly that this is a SPEC DEFECT for
 *  a human — a leaf with zero acceptance criteria proves nothing and passes everything. */
export function vacuousParkReason(plan: DispositionPlan, gateReasons: readonly string[]): string {
  return (
    `blueprint-uncitable-criterion-vacuous: every acceptance criterion (${plan.totalCriteria}) is an ` +
    `uncitable command-result already covered by the mechanical gate; removing them would leave a leaf ` +
    `with ZERO criteria. SPEC DEFECT — the leaf needs at least one criterion naming an observable code ` +
    `change. ${gateReasons.join('; ')}`
  );
}

/** Apply the routed plan to the blueprint: delete every command-result line, and splice in each
 *  replacement the rewrite node actually returned. An unparsed/absent replacement leaves that
 *  criterion EXACTLY as written, so the leaf parks on it precisely as it does today — the repair
 *  can never silently drop a criterion it failed to restate. */
export function applyCriteriaRepair(
  blueprintMd: string,
  plan: DispositionPlan,
  rewriteReplyText: string,
): CriteriaSpliceResult {
  const replacements = parseCriterionReplacements(rewriteReplyText, plan.rewrites.length);
  const rewrites: Array<{ text: string; replacement: string }> = [];
  plan.rewrites.forEach((o, i) => {
    const r = replacements.get(i + 1);
    if (r) rewrites.push({ text: o.text, replacement: r });
  });
  return applyCriteriaDispositions(blueprintMd, { deletes: plan.deletes.map((o) => o.text), rewrites });
}
