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
 * without module mocks.
 */

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
}

/** MAX open cards rendered in full. Bounding matters: the conductor node is the most expensive
 *  node in the harness and this block is paid on EVERY pass. 8 is chosen as ~2x the largest open
 *  card set observed on a live mission (the 3-card serve-cap incident, plus INFRA/land cards), so
 *  the common case is never truncated while a pathological flood cannot balloon the prompt.
 *  Overflow is ANNOUNCED, never silently dropped.
 *  NOT in harness-caps.ts by design: that module's stated purpose is loop-breaker caps and
 *  worker-liveness thresholds. This is a prompt-rendering bound — it breaks no loop and gates no
 *  liveness decision — so it lives with the renderer it bounds. */
export const WAKE_CARD_RENDER_CAP = 8;

/** MAX characters of each card's questionText reproduced in the block. Long enough to carry the
 *  full first sentence of every card kind the harness mints (the serve-cap text is ~260 chars);
 *  the node can always call `escalation_list` for the untruncated text. */
export const WAKE_CARD_EXCERPT_CHARS = 320;

/** MAX criteria listed in the "actionable right now" work list. The node reads the authoritative
 *  list from `get_mission` in step 1 anyway; this is a pointer, not the source of truth. */
export const WAKE_CRITERION_RENDER_CAP = 12;

/** The derived actions that mean "there is work for the conductor on this criterion". */
const ACTIONABLE_ACTIONS: readonly string[] = ['discover', 'verify'];

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
function excerpt(text: string | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '(no question text)';
  if (flat.length <= WAKE_CARD_EXCERPT_CHARS) return flat;
  return `${flat.slice(0, WAKE_CARD_EXCERPT_CHARS)}… [truncated — escalation_list has the full text]`;
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
  const rechecks = [...(input.rechecks ?? [])].sort((a, b) => a.enqueuedAt - b.enqueuedAt);

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
    const shown = actionable.slice(0, WAKE_CRITERION_RENDER_CAP);
    whyLines.push(`  • Criteria ACTIONABLE right now (${actionable.length}):`);
    for (const a of shown) {
      whyLines.push(`      - ${a.id} [${a.action}]${a.text ? ` — ${excerpt(a.text)}` : ''}`);
    }
    if (actionable.length > shown.length) {
      whyLines.push(
        `      - … ${actionable.length - shown.length} more actionable criterion/criteria omitted (cap ${WAKE_CRITERION_RENDER_CAP}); \`get_mission\` lists them all.`,
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
    const shown = rechecks.slice(0, WAKE_CRITERION_RENDER_CAP);
    for (const r of shown) {
      lines.push(
        `  ${r.criterionId}   reason: ${r.reason}   reopened ${formatWakeAge(now - r.enqueuedAt)} ago   landedSha: ${r.landedSha ?? '(none)'}`,
      );
    }
    if (rechecks.length > shown.length) {
      lines.push(
        `  … ${rechecks.length - shown.length} more (cap ${WAKE_CRITERION_RENDER_CAP}); \`get_mission\` lists them all.`,
      );
    }
    lines.push('');
  }

  // ── 2. OPEN CARDS ON THIS MISSION ────────────────────────────────────────────
  lines.push('OPEN CARDS ON THIS MISSION — act on these; do not go looking for them:');
  if (openCards.length === 0) {
    lines.push('  (none open — there is NO open escalation card on this mission right now.)');
  } else {
    const shown = openCards.slice(0, WAKE_CARD_RENDER_CAP);
    let i = 0;
    for (const c of shown) {
      i++;
      const isNew = lastPassAt != null && c.createdAt > lastPassAt;
      lines.push(
        `  [${i}] id: ${c.id}${isNew ? '  (NEW since last pass)' : ''}`,
      );
      lines.push(
        `      kind: ${c.kind}   age: ${formatWakeAge(now - c.createdAt)}   recurrenceCount: ${c.recurrenceCount ?? 0}   conditionKey: ${c.conditionKey ?? '(none)'}`,
      );
      lines.push(`      question: ${excerpt(c.questionText)}`);
    }
    if (openCards.length > shown.length) {
      lines.push(
        `  … ${openCards.length - shown.length} more open card(s) OMITTED from this block (render cap ${WAKE_CARD_RENDER_CAP}). Call \`mcp__mermaid__escalation_list\` to see the rest — they are still open and still yours.`,
      );
    }
    lines.push(
      '  Use the FULL id above with `mcp__mermaid__escalation_resolve` — a short id silently no-ops on that store.',
    );
  }

  lines.push('');
  lines.push('=== END WAKE CONTEXT ===');
  return lines.join('\n');
}
