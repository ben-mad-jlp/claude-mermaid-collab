/**
 * Escalation history read-model (read-only).
 *
 * `escalation_list` returns OPEN escalations only, so the steward can't review
 * what was raised, how it was triaged, and how it turned out. This module is the
 * history view: the full open+resolved escalation trail, filterable by
 * epic/project/todo/session/status/kind/route/time, with a summary mode that
 * answers "is drive-level Grok triage actually resolving escalations, or just
 * bouncing them to the human?".
 *
 * The escalation store is GLOBAL (one supervisor.db across projects), so an
 * unfiltered query spans every project — `limit` defaults to a recent-N window,
 * newest-first.
 *
 * The DB collaborators (escalation rows, the per-escalation human decision, the
 * todo→epic chain) are injected into the pure builders (`buildHistoryRows` /
 * `summarizeHistory`), so the filtering + aggregation logic is unit-testable
 * without a DB. `getEscalationHistory` is the thin store-backed wrapper.
 */
import type { Escalation, EscalationDecision } from './supervisor-store';
import { listEscalations, getEscalationDecision } from './supervisor-store';
import type { Todo } from './todo-store';
import { getTodo } from './todo-store';
import { isEpic } from './todo-kind';
import { listDecisionRecords, type DecisionRecord } from './decision-record-store';

export interface EscalationHistoryFilter {
  /** Resolve via escalation.todoId → parentId chain → the nearest epic-kind ancestor. */
  epicId?: string;
  project?: string;
  todoId?: string;
  session?: string;
  status?: string;
  kind?: string;
  /** 'human' (escalated-to-human) | 'steward' (ai-resolved). */
  routedTo?: string;
  /** Inclusive lower/upper bound on createdAt (ms epoch). */
  since?: number;
  until?: number;
  /** Recent-N cap, newest-first. Default 50. Ignored in summary mode. */
  limit?: number;
  /** Aggregate mode: counts by outcome + avg attempts + median TTR, grouped. */
  summary?: boolean;
}

export interface EscalationHistoryRow {
  id: string;
  project: string;
  session: string;
  kind: string;
  status: string;
  questionText: string;
  todoId: string | null;
  /** The nearest epic-kind ancestor of this escalation's todo, when resolvable. */
  epicId: string | null;
  createdAt: number;
  resolvedAt: number | null;
  /** resolvedAt - createdAt, or null while still open. */
  timeToResolutionMs: number | null;
  /** 'human' (escalated-to-human) | 'steward' (ai-resolved). */
  routedTo: string;
  stewardAttempts: number;
  /** Grok triage bucket+rationale+confidence, when a suggestion was attached. */
  suggestedAction: { bucket: string; confidence: number; rationale: string } | null;
  /** The human's posted answer (optionId/note/decidedBy), when one exists. */
  decision: EscalationDecision | null;
  /** Who resolved it: the decider's handle, else 'daemon-auto' for a steward-routed
   *  resolution with no human decision row, else null while open/undetermined. */
  resolutionActor: string | null;
  /** How many escalations share (project, session, questionText) — the createEscalation
   *  dedup key. >1 means this question recurred. */
  recurrenceCount: number;
}

export interface EscalationHistoryGroup {
  /** epicId when grouping by epic, else project path. */
  key: string;
  total: number;
  autoResolved: number;
  escalatedToHuman: number;
  avgStewardAttempts: number;
  medianTimeToResolutionMs: number | null;
}

export interface EscalationHistorySummary {
  total: number;
  byOutcome: { autoResolved: number; escalatedToHuman: number };
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  avgStewardAttempts: number;
  medianTimeToResolutionMs: number | null;
  /** Grouped by epicId (rows with one), then by project (rows without). */
  groups: EscalationHistoryGroup[];
}

export interface EscalationHistoryResult {
  filter: EscalationHistoryFilter;
  /** Present in summary mode. */
  summary?: EscalationHistorySummary;
  /** Present in list mode (omitted in summary mode). */
  rows?: EscalationHistoryRow[];
  /** Folded-in epic decision records when an epicId filter is given (best-effort). */
  decisionRecords?: DecisionRecord[];
}

/** Median of a numeric list, or null when empty. */
export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Recurrence index: how many escalations share (project, session, questionText). */
export function computeRecurrence(all: Escalation[]): Map<string, number> {
  const key = (e: Escalation) => `${e.project} ${e.session} ${e.questionText}`;
  const counts = new Map<string, number>();
  for (const e of all) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
  const byId = new Map<string, number>();
  for (const e of all) byId.set(e.id, counts.get(key(e)) ?? 1);
  return byId;
}

/**
 * Pure row builder: map + filter escalations into history rows. The epic lookup
 * and per-escalation decision lookup are injected so this needs no DB.
 */
export function buildHistoryRows(
  all: Escalation[],
  filter: EscalationHistoryFilter,
  epicOf: (e: Escalation) => string | null,
  decisionOf: (id: string) => EscalationDecision | null,
): EscalationHistoryRow[] {
  const recurrence = computeRecurrence(all);

  const rows: EscalationHistoryRow[] = [];
  for (const e of all) {
    if (filter.project && e.project !== filter.project) continue;
    if (filter.todoId && e.todoId !== filter.todoId) continue;
    if (filter.session && e.session !== filter.session) continue;
    if (filter.status && e.status !== filter.status) continue;
    if (filter.kind && e.kind !== filter.kind) continue;
    if (filter.routedTo && e.routedTo !== filter.routedTo) continue;
    if (filter.since != null && e.createdAt < filter.since) continue;
    if (filter.until != null && e.createdAt > filter.until) continue;

    const epicId = epicOf(e);
    if (filter.epicId && epicId !== filter.epicId) continue;

    const decision = decisionOf(e.id);
    const timeToResolutionMs = e.resolvedAt != null ? e.resolvedAt - e.createdAt : null;
    // Actor: an explicit decider wins; else a resolved steward-routed escalation is
    // a daemon auto-resolution; else undetermined (still open, or human-routed with
    // no recorded decider — e.g. auto-resolved when its todo completed).
    let resolutionActor: string | null = null;
    if (decision?.decidedBy) resolutionActor = decision.decidedBy;
    else if (e.status !== 'open' && e.routedTo === 'steward') resolutionActor = 'daemon-auto';

    rows.push({
      id: e.id,
      project: e.project,
      session: e.session,
      kind: e.kind,
      status: e.status,
      questionText: e.questionText,
      todoId: e.todoId,
      epicId,
      createdAt: e.createdAt,
      resolvedAt: e.resolvedAt,
      timeToResolutionMs,
      // `routedTo` is a retired, read-model-only field (audience supersedes it).
      // The store type made it optional; legacy rows coalesce to 'human'.
      routedTo: e.routedTo ?? 'human',
      stewardAttempts: e.stewardAttempts ?? 0,
      suggestedAction: e.suggestedAction
        ? {
            bucket: e.suggestedAction.bucket,
            confidence: e.suggestedAction.confidence,
            rationale: e.suggestedAction.rationale,
          }
        : null,
      decision,
      resolutionActor,
      recurrenceCount: recurrence.get(e.id) ?? 1,
    });
  }

  // Newest-first.
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

/** Pure aggregation over already-filtered rows. */
export function summarizeHistory(rows: EscalationHistoryRow[]): EscalationHistorySummary {
  const autoResolved = rows.filter((r) => r.routedTo === 'steward').length;
  const escalatedToHuman = rows.filter((r) => r.routedTo === 'human').length;

  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  }

  const avgStewardAttempts =
    rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.stewardAttempts, 0) / rows.length;
  const ttrs = rows.map((r) => r.timeToResolutionMs).filter((v): v is number => v != null);

  // Group by epicId when present, else by project — so an unfiltered global query
  // still breaks down per project.
  const groupKeys = new Map<string, EscalationHistoryRow[]>();
  for (const r of rows) {
    const key = r.epicId ?? r.project;
    const arr = groupKeys.get(key) ?? [];
    arr.push(r);
    groupKeys.set(key, arr);
  }
  const groups: EscalationHistoryGroup[] = [...groupKeys.entries()].map(([key, gr]) => ({
    key,
    total: gr.length,
    autoResolved: gr.filter((r) => r.routedTo === 'steward').length,
    escalatedToHuman: gr.filter((r) => r.routedTo === 'human').length,
    avgStewardAttempts: gr.reduce((s, r) => s + r.stewardAttempts, 0) / gr.length,
    medianTimeToResolutionMs: median(
      gr.map((r) => r.timeToResolutionMs).filter((v): v is number => v != null),
    ),
  }));
  groups.sort((a, b) => b.total - a.total);

  return {
    total: rows.length,
    byOutcome: { autoResolved, escalatedToHuman },
    byStatus,
    byKind,
    avgStewardAttempts,
    medianTimeToResolutionMs: median(ttrs),
    groups,
  };
}

const DEFAULT_LIMIT = 50;

/** Resolve an escalation's nearest epic-kind ancestor by walking todoId → parentId.
 *  Role is read from `kind` (todo-kind.isEpic), never from the title. Cycle-safe;
 *  null when there is no todo link or no epic ancestor. Memoised per (project,todoId). */
function makeEpicResolver(): (e: Escalation) => string | null {
  const cache = new Map<string, string | null>();
  return (e: Escalation): string | null => {
    if (!e.todoId) return null;
    const ck = `${e.project} ${e.todoId}`;
    if (cache.has(ck)) return cache.get(ck)!;
    const seen = new Set<string>();
    let cur: Todo | null = getTodo(e.project, e.todoId);
    let found: string | null = null;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      // A [MISSION] ancestor is not an epic and must not terminate the walk;
      // isEpic returns false for kind==='mission', same as the old /^\[EPIC\]/ regex.
      if (isEpic(cur)) { found = cur.id; break; }
      cur = cur.parentId ? getTodo(e.project, cur.parentId) : null;
    }
    cache.set(ck, found);
    return found;
  };
}

/**
 * Store-backed entry point: load the global escalation trail and apply the filter.
 * In list mode returns the recent-N rows (newest-first) + optional folded-in epic
 * decision records; in summary mode returns the aggregate breakdown.
 */
export function getEscalationHistory(filter: EscalationHistoryFilter = {}): EscalationHistoryResult {
  const all = listEscalations(); // every escalation, all statuses, all projects
  const epicOf = makeEpicResolver();
  const rows = buildHistoryRows(all, filter, epicOf, (id) => getEscalationDecision(id));

  if (filter.summary) {
    return { filter, summary: summarizeHistory(rows) };
  }

  const limit = filter.limit != null && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;
  const limited = rows.slice(0, limit);

  // Fold in the epic's decision records when an epicId is given (best-effort): the
  // combined "what happened on this epic" view. Resolve the project from the filter
  // or from the matched rows (the global store may span projects).
  let decisionRecords: DecisionRecord[] | undefined;
  if (filter.epicId) {
    const projects = filter.project
      ? [filter.project]
      : [...new Set(limited.map((r) => r.project))];
    const recs: DecisionRecord[] = [];
    for (const project of projects) {
      try {
        recs.push(...listDecisionRecords(project, { epicId: filter.epicId }));
      } catch {
        // best-effort: a project whose decision store is unavailable is skipped.
      }
    }
    decisionRecords = recs;
  }

  return { filter, rows: limited, ...(decisionRecords ? { decisionRecords } : {}) };
}
