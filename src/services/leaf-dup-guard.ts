// Duplicate-of-done leaf guard — the CODE half of the planner's "DUP-CHECK BEFORE FILING"
// rule (src/mcp/tools/mission-planner.ts buildPlannerPrompt). A prohibition that lives only
// in a prompt is not a constraint; this module is what actually checks it at filing time.
//
// INCIDENT (mission a6ab522b, 2026-07-24): epic d43c6386 built and LANDED two leaves —
//   c2358ad9 "Gate the INFRA base re-probe on a deterministic lane signature + trunk HEAD"
//   981474ad "Yield a stalled leader's turn to an actionable rival in deterministic-select"
// A later epic f28d63d3, serving the SAME acceptance criterion, was filed with two brand-new
// full-tier leaves re-specifying that already-landed work near-verbatim —
//   7754e85c "Make the base-red re-probe deterministic scheduling code gated on lane signature + trunk HEAD"
//   b56e6f53 "Yield a stalled leader's turn to an actionable rival in deterministic-select"
// Both got blueprints; one was CLAIMED and burning tokens (~500k cache-read each) before a
// human stopped it. This module refuses that filing at the source.
//
// Everything here is PURE except buildMissionDoneLeafIndex (one listTodos read). The caller
// (addLeavesToEpic) FAILS OPEN on any throw from this module — a store hiccup must never
// block legitimate filing.
import { listTodos, type Todo } from './todo-store.js';
import { isEpic, isLeaf, isMission } from './todo-kind.js';
import { hasLandStamp } from './epic-landedness.js';

/** Words carrying no discriminating signal in a work-item title. Dropped before comparison
 *  so "Gate the INFRA base re-probe ON A ..." and "Make THE base-red re-probe ... ON ..."
 *  are compared on their content words only. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'as', 'is', 'are', 'be', 'was', 'were', 'that', 'this', 'it', 'its', 'into', 'onto',
  'when', 'then', 'than', 'so', 'but', 'not', 'no', 'if', 'we', 'you', 'our', 'their',
  'via', 'per', 'over', 'under', 'out', 'up', 'down', 'do', 'does', 'did',
]);

/** Light suffix stripper. NOT linguistically correct — it only has to be CONSISTENT on both
 *  sides of a comparison, which is what makes "gated" (the re-filed leaf) collapse onto
 *  "gate" (the landed leaf) instead of reading as a distinct content word. */
function stem(tok: string): string {
  let t = tok;
  if (t.length > 4 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('es')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith('e')) t = t.slice(0, -1);
  return t;
}

/**
 * lowercase → strip punctuation (hyphens/apostrophes become separators, so "re-probe" →
 * re + probe and "leader's" → leader + s) → drop 1-char tokens → drop stopwords → stem.
 * Returns the deduplicated token SET.
 */
export function normalizeTitleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(title ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;          // drops the "s" of "leader's", stray letters
    if (STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** Overlap (Szymkiewicz–Simpson) coefficient: |A∩B| / min(|A|,|B|). Chosen over Jaccard
 *  because the real incident pair re-worded the SAME work with extra filler ("Make … code
 *  scheduling …") — Jaccard scores that pair 0.64 (a miss) while overlap scores 0.90. The
 *  min() denominator is only safe together with LEN_RATIO_MAX below, which refuses to
 *  compare a terse title against a much longer one. */
export function titleOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

/** Overlap at or above this REFUSES the filing. Deliberately HIGH: a false refusal wedges
 *  the conductor mid-mission, so the bias is hard toward allowing. Calibrated on the
 *  a6ab522b incident pair (0.90 — refused) against a realistic near-miss such as
 *  "Add a retry cap to the blueprint node" vs "… to the review node" (0.80 — allowed). */
export const DUP_TITLE_OVERLAP_THRESHOLD = 0.85;

/** Below this many content tokens a title is too thin for fuzzy matching (only an EXACT
 *  normalized-set match refuses). Guards "Fix the flaky test" from swallowing every longer
 *  title that happens to contain it. */
export const DUP_MIN_TOKENS = 4;

/** Max |longer| / |shorter| token-count ratio for the fuzzy branch. A much longer title is
 *  a genuinely bigger scope even when it contains every word of the shorter one, so it is
 *  compared by exact-set equality only. */
export const DUP_LEN_RATIO_MAX = 1.6;

/** An already-DONE leaf under the same mission, indexed for comparison. */
export interface DoneLeafEntry {
  leafId: string;
  leafTitle: string;
  epicId: string;
  epicTitle: string;
  /** Why it counts as done: the leaf itself was accepted, or its epic has landedAt set. */
  reason: 'accepted' | 'epic-landed';
  tokens: Set<string>;
}

export interface DuplicateLeafMatch {
  leafId: string;
  leafTitle: string;
  epicId: string;
  epicTitle: string;
  reason: 'accepted' | 'epic-landed';
  /** 1 for an exact normalized-title match, else the overlap coefficient. */
  similarity: number;
}

/**
 * Every DONE leaf in the given mission's closure: mission → its epics → their leaves.
 * "Done" is strictly `acceptanceStatus === 'accepted'` OR the owning epic has `landedAt`
 * set — a rejected / dropped / in-flight sibling is NOT a duplicate source (re-filing over
 * one of those is legitimate re-work).
 *
 * Single project-wide read, mirroring the walk in coordinator-land.ts (listTodos with
 * includeCompleted, filtered to the mission's epics) — there is no shared mission-closure
 * helper to reuse; mission-store's collectMissionStatusFacts computes facts, not the leaf set.
 */
export function buildMissionDoneLeafIndex(project: string, missionId: string): DoneLeafEntry[] {
  const all = listTodos(project, { includeCompleted: true, includeArchived: true });
  const byParent = new Map<string, Todo[]>();
  for (const t of all) {
    if (!t.parentId) continue;
    const bucket = byParent.get(t.parentId);
    if (bucket) bucket.push(t);
    else byParent.set(t.parentId, [t]);
  }

  const entries: DoneLeafEntry[] = [];
  for (const epic of byParent.get(missionId) ?? []) {
    if (!isEpic(epic) || epic.isBucket) continue;
    // Deliberately stamp-only: we check ONLY the landedAt column, not the done [LAND] leaf
    const epicLanded = hasLandStamp(epic);
    for (const leaf of byParent.get(epic.id) ?? []) {
      if (!isLeaf(leaf)) continue;
      if (leaf.status === 'dropped') continue;
      const accepted = leaf.acceptanceStatus === 'accepted';
      if (!accepted && !epicLanded) continue;
      entries.push({
        leafId: leaf.id,
        leafTitle: leaf.title,
        epicId: epic.id,
        epicTitle: epic.title,
        reason: accepted ? 'accepted' : 'epic-landed',
        tokens: normalizeTitleTokens(leaf.title),
      });
    }
  }
  return entries;
}

/** Resolves the MISSION a filing epic is homed to, or null when the epic is root-homed /
 *  its parent is not a mission node (non-mission-homed epics are exempt from the guard). */
export function missionOfEpic(
  epic: Pick<Todo, 'parentId'>,
  getTodoFn: (id: string) => Todo | null | undefined,
): string | null {
  if (!epic.parentId) return null;
  const parent = getTodoFn(epic.parentId);
  return parent && isMission(parent) ? parent.id : null;
}

/** Minimum length for a token to read as a SYMBOL rather than prose (`isgrokprovider`,
 *  `nodeprovider`) once normalization has flattened camelCase and punctuation away. */
export const DUP_IDENTIFIER_MIN_LEN = 8;

/**
 * Do the two titles each name a DISTINCT subject the other never mentions? A well-decomposed
 * epic files siblings that share every prose word and differ only in the symbol they target
 * ("[grok-exp D] Add a pure isGrokProvider(p) helper to node-provider.ts" vs the same line with
 * `isClaudeProvider`) — measured at 0.89 overlap against the real corpus, which the fuzzy branch
 * would REFUSE. That is the costliest false positive available: a refused leaf makes the planner
 * drop the whole epic. So when BOTH sides carry a unique identifier-like token, the titles are
 * about different things and the fuzzy branch must stand down.
 *
 * Deliberately requires the signal on BOTH sides: the real 2026-07-24 incident pair differs only
 * by prose filler (onlyA = mak/red/schedul/cod, onlyB = infra — no identifier either side), so it
 * is untouched by this carve-out and still refuses.
 */
export function namesDistinctSubjects(a: Set<string>, b: Set<string>): boolean {
  const idLike = (t: string) => t.length >= DUP_IDENTIFIER_MIN_LEN || /\d/.test(t);
  const onlyA = [...a].filter((t) => !b.has(t));
  const onlyB = [...b].filter((t) => !a.has(t));
  return onlyA.some(idLike) && onlyB.some(idLike);
}

/** First done-leaf in `index` that the candidate title duplicates, else null. */
export function findDuplicateDoneLeaf(index: DoneLeafEntry[], title: string): DuplicateLeafMatch | null {
  const cand = normalizeTitleTokens(title);
  if (cand.size === 0) return null;
  for (const e of index) {
    if (e.tokens.size === 0) continue;
    const exact = cand.size === e.tokens.size && [...cand].every((t) => e.tokens.has(t));
    if (exact) return { ...pick(e), similarity: 1 };
    if (cand.size < DUP_MIN_TOKENS || e.tokens.size < DUP_MIN_TOKENS) continue;
    const ratio = Math.max(cand.size, e.tokens.size) / Math.min(cand.size, e.tokens.size);
    if (ratio > DUP_LEN_RATIO_MAX) continue;
    // Only the FUZZY branch stands down — an exact normalized-title match above is still a
    // duplicate no matter what symbols it names.
    if (namesDistinctSubjects(cand, e.tokens)) continue;
    const sim = titleOverlap(cand, e.tokens);
    if (sim >= DUP_TITLE_OVERLAP_THRESHOLD) return { ...pick(e), similarity: sim };
  }
  return null;
}

function pick(e: DoneLeafEntry): Omit<DuplicateLeafMatch, 'similarity'> {
  return { leafId: e.leafId, leafTitle: e.leafTitle, epicId: e.epicId, epicTitle: e.epicTitle, reason: e.reason };
}
