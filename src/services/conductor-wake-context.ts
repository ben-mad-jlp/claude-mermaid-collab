/**
 * conductor-wake-context — renders the WAKE CONTEXT block that is injected into the conductor
 * node's prompt.
 *
 * WHY THIS EXISTS. Escalation cards are a WAKE signal for the conductor: their ids are folded
 * into the debounce fingerprint (conductor-signature.ts), so a new or resolved card is exactly
 * what breaks the debounce and spends a node. But their CONTENT was never handed to that node —
 * the prompt only *instructed* the model to go call `escalation_list` itself. A prompt
 * instruction is not a constraint (see CLAUDE.md "Lessons → shipped surfaces"): on 2026-07-24
 * three `criterion-serve-cap` cards woke the conductor and then sat unacted-on for hours because
 * nothing in the prompt told the node they existed. If the machinery knows something, it HANDS
 * it to the node.
 *
 * This module is PURE: no store reads, no I/O, no clock of its own (the caller passes `now`).
 * Everything it renders arrives as plain data, so it is unit-testable without a database and
 * without module mocks. (The one import, VERIFY_LENSES, is a frozen pure constant — the three
 * distinct-lens names — not a store or clock.)
 */

import { VERIFY_LENSES } from './criterion-verify-panel.ts';
import { CONDUCTOR_SERVE_BATCH_MAX } from './harness-caps.ts';

/** One escalation card, reduced to the fields the block renders. Structurally a subset of
 *  supervisor-store's `Escalation`, declared locally so this module imports nothing. */
export interface WakeCard {
  /** FULL id. Rendered in full on purpose: the resolve verbs key on the full id and a short id
   *  silently no-ops on that store. */
  id: string;
  kind: string;
  createdAt: number;
  resolvedAt?: number | null;
  conditionKey?: string | null;
  recurrenceCount?: number;
  questionText?: string;
}

/** One criterion's derived action, reduced to what the work list renders. */
export interface WakeCriterion {
  id: string;
  action: string;
  text?: string;
  /** MissionCriterion.met, rendered as 'MET'/'NOT MET' — only when verifiedAt is set (a
   *  never-verified criterion has no verdict yet, `met` defaults false and would lie). */
  verdict?: string;
  /** MissionCriterion.evidence — the verify judge's cited reasoning. */
  evidence?: string;
}

/** One criterion's high-stakes verify classification, reduced to what the panel section renders.
 *  Structurally a subset of criterion-verify-stakes.ts's `VerifyStakesResult` plus the criterion id.
 *  Only entries with `panel === true` are rendered: the panel is OPT-IN on the enumerated triggers
 *  (reopened-by-land / contested-card / serve-burn). A fresh/unserved criterion classifies
 *  `panel === false` and MUST NOT produce a HIGH-STAKES VERIFY entry. */
export interface WakeStakes {
  criterionId: string;
  panel: boolean;
  /** Which high-stakes trigger fired (only meaningful when panel===true). */
  trigger: string | null;
  checkerCount: number;
}

/** One pending recheck from the mission_recheck queue. Structurally a subset of `MissionRecheck`
 *  (mission-store.ts:148) minus `todoId` (the block is already mission-scoped), declared locally
 *  so this module imports nothing. */
export interface WakeRecheck {
  criterionId: string;
  reason: string;
  landedSha: string | null;
  enqueuedAt: number;
}

export interface WakeContextInput {
  missionId: string;
  missionTitle?: string;
  /** Wall clock used for every age computation. Passed in so the render is deterministic. */
  now: number;
  /** `mission.lastConductorPassAt` — the delta boundary. Null on a mission the conductor has
   *  never passed on (then nothing can be attributed as "new since"). */
  lastPassAt: number | null;
  /** Every OPEN (or acknowledged) escalation scoped to this mission's todo tree. */
  openCards: readonly WakeCard[];
  /** Cards RESOLVED since `lastPassAt`. A resolution is itself a wake cause — it moves the
   *  debounce fingerprint — and it means a human ANSWERED something. */
  resolvedCards?: readonly WakeCard[];
  /** Per-criterion derived actions (listCriteriaWithActions), all of them; the work list picks
   *  out `discover`/`verify`. */
  actions?: readonly WakeCriterion[];
  /** Criteria that lost their verdict and must be re-verified. Sourced from mission-recheck-drain.ts's
   *  surviving `pending` list. */
  rechecks?: readonly WakeRecheck[];
  /** Per-criterion high-stakes verify classification (conductor-pass runs classifyVerifyStakes for
   *  every `verify` criterion). ONLY entries with `panel === true` render a HIGH-STAKES VERIFY entry;
   *  a fresh/unserved criterion (panel===false, or simply absent from this list) never appears. */
  stakes?: readonly WakeStakes[];
}

/** MAX open cards rendered in full. Bounding matters: the conductor node is the most expensive
 *  node in the harness and this block is paid on EVERY pass. 8 is chosen as ~2x the largest open
 *  card set observed on a live mission (the 3-card serve-cap incident, plus INFRA/land cards), so
 *  the common case is never truncated while a pathological flood cannot balloon the prompt.
 *  Overflow is ANNOUNCED, never silently dropped.
 *  NOT in harness-caps.ts by design: that module's stated purpose is loop-breaker caps and
 *  worker-liveness thresholds. This is a prompt-rendering bound — it breaks no loop and gates no
 *  liveness decision — so it lives with the renderer it bounds. `CONDUCTOR_SERVE_BATCH_MAX` is
 *  the deliberate exception: it DOES live in harness-caps.ts, because it gates work WIDTH (how
 *  many `discover` gaps the node may act on this pass), not render width (how much text is shown
 *  for that work) — a loop-breaker cap, not a prompt-rendering bound. */
export const WAKE_CARD_RENDER_CAP = 8;

/** Total char ceiling on buildConductorPrompt's ENTIRE output (this block + the fixed step
 *  text). Verdict/evidence text (§1) can each run multi-thousand chars per criterion, so the
 *  per-section item caps (WAKE_CARD_RENDER_CAP, WAKE_CRITERION_RENDER_CAP) no longer bound the
 *  total — this does. NOT in harness-caps.ts, same rationale as WAKE_CARD_RENDER_CAP (above):
 *  a prompt-rendering bound, breaks no loop, gates no liveness decision — lives with the
 *  renderer it bounds. */
export const CONDUCTOR_PROMPT_RENDER_CAP_CHARS = 24_000;

/** Conservative reserve for buildConductorPrompt's fixed step text + mission id/title
 *  boilerplate (conductor-pass.ts:198-240), measured with headroom so the wake block's own
 *  budget (CAP - this reserve) keeps the COMBINED prompt under CONDUCTOR_PROMPT_RENDER_CAP_CHARS
 *  for any realistic missionTitle. */
const CONDUCTOR_PROMPT_STATIC_RESERVE_CHARS = 4_000;

/** MAX characters of each card's questionText reproduced in the block. Long enough to carry the
 *  full first sentence of every card kind the harness mints (the serve-cap text is ~260 chars);
 *  the node can always call `escalation_get <id>` for the untruncated text. */
export const WAKE_CARD_EXCERPT_CHARS = 320;

/** MAX criteria listed in the "actionable right now" work list. The node reads the authoritative
 *  list from `get_mission` in step 1 anyway; this is a pointer, not the source of truth. */
export const WAKE_CRITERION_RENDER_CAP = 12;

/** The derived actions that mean "there is work for the conductor on this criterion". */
export const ACTIONABLE_ACTIONS: readonly string[] = ['discover', 'verify'];

/** Compact human age, e.g. "45s", "12m", "3h12m", "2d3h". Never negative (clock skew → "0s"). */
export function formatWakeAge(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

/** One-line, whitespace-collapsed excerpt of a card's question text, capped and marked when cut. */
function excerpt(text: string | undefined, id?: string): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '(no question text)';
  if (flat.length <= WAKE_CARD_EXCERPT_CHARS) return flat;
  const idSuffix = id ? ` ${id}` : '';
  return `${flat.slice(0, WAKE_CARD_EXCERPT_CHARS)}… [truncated — escalation_get${idSuffix} has the full text]`;
}

/**
 * Render the WAKE CONTEXT block. Always returns a non-empty string: an empty delta and a
 * zero-card mission are INFORMATION and are stated explicitly, never omitted (an absent section
 * reads to the model as "not checked", which is the failure this block exists to prevent).
 */
export function buildWakeContextBlock(input: WakeContextInput): string {
  const now = input.now;
  const lastPassAt = input.lastPassAt;
  const openCards = [...(input.openCards ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  const resolvedCards = [...(input.resolvedCards ?? [])].sort(
    (a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0),
  );
  const actionable = (input.actions ?? []).filter((a) => ACTIONABLE_ACTIONS.includes(a.action));
  const discoverGaps = actionable.filter((a) => a.action === 'discover');
  const rechecks = [...(input.rechecks ?? [])].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  const panelStakes = (input.stakes ?? []).filter((s) => s.panel === true);

  const shownDiscover = discoverGaps.slice(0, CONDUCTOR_SERVE_BATCH_MAX);
  const shownVerify = actionable.filter((a) => a.action === 'verify').slice(0, WAKE_CRITERION_RENDER_CAP);
  const shownActionable = [...shownDiscover, ...shownVerify];
  const shownCards = openCards.slice(0, WAKE_CARD_RENDER_CAP);
  const shownRechecks = rechecks.slice(0, WAKE_CRITERION_RENDER_CAP);
  const shownStakes = panelStakes.slice(0, WAKE_CRITERION_RENDER_CAP);
  const lensNames = VERIFY_LENSES.join(', ');

  // Drop state, mutated by the total-cap enforcement loop below. Priority 0 (dropped first):
  // individual open-card items beyond the first kept. Priority 1: per-criterion verdict/evidence
  // annotations. Priority 2: HIGH-STAKES VERIFY entries. Priority 3: REOPENED entries.
  const droppedCardIdx = new Set<number>();
  const droppedAnnotationIdx = new Set<number>();
  const droppedStakesIdx = new Set<number>();
  const droppedRecheckIdx = new Set<number>();

  function annotationSize(a: WakeCriterion): number {
    let n = 0;
    if (a.verdict) n += a.verdict.length + 20;
    if (a.evidence) n += excerpt(a.evidence).length + 20;
    return n;
  }

  function cardItemSize(c: WakeCard): number {
    return excerpt(c.questionText).length + c.id.length + c.kind.length + 40;
  }

  function pickDropCandidate(): { tier: 0 | 1 | 2 | 3; idx: number } | null {
    // Tier 0: open cards, never drop the last one kept.
    if (shownCards.length - droppedCardIdx.size > 1) {
      let best = -1;
      let bestSize = -1;
      for (let idx = 0; idx < shownCards.length; idx++) {
        if (droppedCardIdx.has(idx)) continue;
        const size = cardItemSize(shownCards[idx]);
        if (size > bestSize) {
          bestSize = size;
          best = idx;
        }
      }
      if (best >= 0) return { tier: 0, idx: best };
    }
    // Tier 1: criterion verdict/evidence annotations.
    {
      let best = -1;
      let bestSize = -1;
      for (let idx = 0; idx < shownActionable.length; idx++) {
        if (droppedAnnotationIdx.has(idx)) continue;
        const a = shownActionable[idx];
        if (!a.verdict && !a.evidence) continue;
        const size = annotationSize(a);
        if (size > bestSize) {
          bestSize = size;
          best = idx;
        }
      }
      if (best >= 0) return { tier: 1, idx: best };
    }
    // Tier 2: HIGH-STAKES VERIFY entries.
    if (shownStakes.length - droppedStakesIdx.size > 0) {
      let best = -1;
      let bestSize = -1;
      for (let idx = 0; idx < shownStakes.length; idx++) {
        if (droppedStakesIdx.has(idx)) continue;
        const s = shownStakes[idx];
        const size = (s.trigger ?? '').length + s.criterionId.length + 40;
        if (size > bestSize) {
          bestSize = size;
          best = idx;
        }
      }
      if (best >= 0) return { tier: 2, idx: best };
    }
    // Tier 3: REOPENED entries.
    if (shownRechecks.length - droppedRecheckIdx.size > 0) {
      let best = -1;
      let bestSize = -1;
      for (let idx = 0; idx < shownRechecks.length; idx++) {
        if (droppedRecheckIdx.has(idx)) continue;
        const r = shownRechecks[idx];
        const size = r.reason.length + r.criterionId.length + 40;
        if (size > bestSize) {
          bestSize = size;
          best = idx;
        }
      }
      if (best >= 0) return { tier: 3, idx: best };
    }
    return null;
  }

  function assemble(): string[] {
    const lines: string[] = [];
    lines.push('=== WAKE CONTEXT (injected by the harness — this is DATA already fetched for you) ===');
    lines.push('');

    // ── 1. WHY YOU WERE WOKEN ────────────────────────────────────────────────────
    lines.push(
      lastPassAt == null
        ? 'WHY YOU WERE WOKEN (no previous conductor pass recorded on this mission — everything below is new to you):'
        : `WHY YOU WERE WOKEN (delta since your last pass ${formatWakeAge(now - lastPassAt)} ago):`,
    );

    const newCards = lastPassAt == null ? openCards : openCards.filter((c) => c.createdAt > lastPassAt);
    const whyLines: string[] = [];
    for (const c of newCards) {
      whyLines.push(
        `  • NEW card ${c.id} (${c.kind}${c.conditionKey ? `, conditionKey ${c.conditionKey}` : ''}) opened ${formatWakeAge(now - c.createdAt)} ago`,
      );
    }
    for (const c of resolvedCards) {
      whyLines.push(
        `  • RESOLVED since your last pass: card ${c.id} (${c.kind}${c.conditionKey ? `, conditionKey ${c.conditionKey}` : ''})` +
          ` — a human ANSWERED this; read the answer and act on it, do not re-raise it.`,
      );
    }
    if (actionable.length > 0) {
      whyLines.push(`  • Criteria ACTIONABLE right now (${actionable.length}):`);
      let annotationsOmitted = 0;
      for (let idx = 0; idx < shownActionable.length; idx++) {
        const a = shownActionable[idx];
        whyLines.push(`      - ${a.id} [${a.action}]${a.text ? ` — ${excerpt(a.text)}` : ''}`);
        if (droppedAnnotationIdx.has(idx)) {
          annotationsOmitted++;
          continue;
        }
        if (a.verdict) whyLines.push(`          verdict: ${a.verdict}`);
        if (a.evidence) whyLines.push(`          evidence: ${excerpt(a.evidence)}`);
      }
      if (actionable.length > shownActionable.length) {
        whyLines.push(
          `      - … ${actionable.length - shownActionable.length} more actionable criterion/criteria omitted (cap ${WAKE_CRITERION_RENDER_CAP}); \`get_mission\` lists them all.`,
        );
      }
      if (discoverGaps.length > shownDiscover.length) {
        whyLines.push(
          `      - … ${discoverGaps.length - shownDiscover.length} more \`discover\` gap(s) CARRIED to the next pass (serve bound ${CONDUCTOR_SERVE_BATCH_MAX}) — they are still open and still yours; do NOT try to serve them this pass.`,
        );
      }
      if (annotationsOmitted > 0) {
        whyLines.push(
          `      - … verdict/evidence omitted for ${annotationsOmitted} criterion/criteria above (total prompt cap ${CONDUCTOR_PROMPT_RENDER_CAP_CHARS} chars); \`get_mission\` has the full verdict/evidence.`,
        );
      }
    }
    if (whyLines.length === 0) {
      whyLines.push(
        '  • Nothing could be attributed: no card opened or resolved since your last pass, and no criterion is `discover` or `verify` right now. An empty delta is itself information — do not invent work.',
      );
    }
    lines.push(...whyLines);
    lines.push('');

    // ── 1.5 REOPENED CRITERIA ────────────────────────────────────────────────────
    if (rechecks.length > 0) {
      lines.push(`REOPENED — needs re-verify (${rechecks.length} criterion/criteria lost verdict):`);
      let recheckDropped = 0;
      for (let idx = 0; idx < shownRechecks.length; idx++) {
        if (droppedRecheckIdx.has(idx)) {
          recheckDropped++;
          continue;
        }
        const r = shownRechecks[idx];
        lines.push(
          `  ${r.criterionId}   reason: ${r.reason}   reopened ${formatWakeAge(now - r.enqueuedAt)} ago   landedSha: ${r.landedSha ?? '(none)'}`,
        );
      }
      const cappedOmitted = rechecks.length - shownRechecks.length;
      const totalOmitted = cappedOmitted + recheckDropped;
      if (totalOmitted > 0) {
        lines.push(
          recheckDropped > 0
            ? `  … ${totalOmitted} more omitted (total prompt cap ${CONDUCTOR_PROMPT_RENDER_CAP_CHARS} chars); \`get_mission\` lists them all.`
            : `  … ${totalOmitted} more (cap ${WAKE_CRITERION_RENDER_CAP}); \`get_mission\` lists them all.`,
        );
      }
      lines.push('');
    }

    // ── 1.6 HIGH-STAKES VERIFY (distinct-lens panel) ─────────────────────────────
    // OPT-IN: only criteria classified panel===true (an enumerated trigger fired) appear. Absent
    // entirely when nothing is high-stakes — an absent section is correct here (a fresh criterion is
    // NOT high-stakes), unlike the OPEN CARDS section whose absence would read as "not checked".
    if (panelStakes.length > 0) {
      lines.push('HIGH-STAKES VERIFY — automatically paneled by the conductor pass:');
      lines.push(
        `  The three lenses (${lensNames}) already ran this pass; verdicts are recorded.` +
          ' (A criterion below with its verdict unchanged since the last check is informational — already verified.)',
      );
      let stakesDropped = 0;
      for (let idx = 0; idx < shownStakes.length; idx++) {
        if (droppedStakesIdx.has(idx)) {
          stakesDropped++;
          continue;
        }
        const s = shownStakes[idx];
        lines.push(`  • ${s.criterionId}   trigger: ${s.trigger ?? '(unknown)'}   lenses: ${lensNames}`);
      }
      const cappedOmitted = panelStakes.length - shownStakes.length;
      const totalOmitted = cappedOmitted + stakesDropped;
      if (totalOmitted > 0) {
        lines.push(
          stakesDropped > 0
            ? `  … ${totalOmitted} more high-stakes criterion/criteria omitted (total prompt cap ${CONDUCTOR_PROMPT_RENDER_CAP_CHARS} chars); \`get_mission\` lists them all.`
            : `  … ${totalOmitted} more high-stakes criterion/criteria omitted (cap ${WAKE_CRITERION_RENDER_CAP}); \`get_mission\` lists them all.`,
        );
      }
      lines.push('');
    }

    // ── 2. OPEN CARDS ON THIS MISSION ────────────────────────────────────────────
    lines.push('OPEN CARDS ON THIS MISSION — act on these; do not go looking for them:');
    if (openCards.length === 0) {
      lines.push('  (none open — there is NO open escalation card on this mission right now.)');
    } else {
      let i = 0;
      let cardsDropped = 0;
      for (let idx = 0; idx < shownCards.length; idx++) {
        if (droppedCardIdx.has(idx)) {
          cardsDropped++;
          continue;
        }
        const c = shownCards[idx];
        i++;
        const isNew = lastPassAt != null && c.createdAt > lastPassAt;
        lines.push(`  [${i}] id: ${c.id}${isNew ? '  (NEW since last pass)' : ''}`);
        lines.push(
          `      kind: ${c.kind}   age: ${formatWakeAge(now - c.createdAt)}   recurrenceCount: ${c.recurrenceCount ?? 0}   conditionKey: ${c.conditionKey ?? '(none)'}`,
        );
        lines.push(`      question: ${excerpt(c.questionText, c.id)}`);
      }
      const cappedOmitted = openCards.length - shownCards.length;
      const totalOmitted = cappedOmitted + cardsDropped;
      if (totalOmitted > 0) {
        lines.push(
          cardsDropped > 0
            ? `  … ${totalOmitted} more open card(s) OMITTED from this block (total prompt cap ${CONDUCTOR_PROMPT_RENDER_CAP_CHARS} chars). Call \`mcp__mermaid__escalation_list\` to see the rest — they are still open and still yours.`
            : `  … ${totalOmitted} more open card(s) OMITTED from this block (render cap ${WAKE_CARD_RENDER_CAP}). Call \`mcp__mermaid__escalation_list\` to see the rest — they are still open and still yours.`,
        );
      }
      lines.push(
        '  Use the FULL id above with `mcp__mermaid__escalation_resolve` — a short id silently no-ops on that store.',
      );
    }

    lines.push('');
    lines.push('=== END WAKE CONTEXT ===');
    return lines;
  }

  const budget = CONDUCTOR_PROMPT_RENDER_CAP_CHARS - CONDUCTOR_PROMPT_STATIC_RESERVE_CHARS;
  let lines = assemble();
  while (lines.join('\n').length > budget) {
    const candidate = pickDropCandidate();
    if (!candidate) break;
    if (candidate.tier === 0) droppedCardIdx.add(candidate.idx);
    else if (candidate.tier === 1) droppedAnnotationIdx.add(candidate.idx);
    else if (candidate.tier === 2) droppedStakesIdx.add(candidate.idx);
    else droppedRecheckIdx.add(candidate.idx);
    lines = assemble();
  }

  return lines.join('\n');
}
