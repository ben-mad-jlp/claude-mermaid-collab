/**
 * epicHistory — PURE merge of an epic's escalation trail + decision records into
 * one chronological timeline (todo b05125b6).
 *
 * USER PAIN this answers: open escalations VANISH on resolve, so "what
 * escalations/decisions happened on this epic and how were they handled?" had no
 * surface. The Bridge open inbox shows only live ones; the decision records live in
 * a different store. This module folds both — including RESOLVED escalations with
 * their triage outcome — into a single sorted list the EpicHistoryView renders.
 *
 * The escalation rows come from the server's escalation-history read-model
 * (src/services/escalation-history.ts → EscalationHistoryRow); the decision records
 * from list_decision_records (DecisionRecord). Both arrive on the SAME
 * /api/supervisor/escalation-history?epicId= response (it folds in the epic's
 * decision records), so the view does one fetch on open — no new WS event, no poll.
 *
 * Lifecycle REUSE: an escalation's triage outcome is the shared EscalationLifecycle
 * vocabulary (escalationLifecycle.ts). The history row doesn't carry the live
 * Escalation shape, so `escalationRowLifecycle` reconstructs the minimal Escalation
 * fields the classifier needs and delegates to classifyEscalationLifecycle — the
 * states are NOT re-derived here.
 */

import {
  classifyEscalationLifecycle,
  type EscalationLifecycle,
  type LifecyclePresentation,
} from './escalationLifecycle';
import type { Escalation } from '@/stores/supervisorStore';

/** One escalation row from the server escalation-history read-model (the subset the
 *  timeline needs; the wire carries more). Mirrors EscalationHistoryRow. */
export interface EscalationHistoryRow {
  id: string;
  project: string;
  session: string;
  kind: string;
  status: string;
  questionText: string;
  todoId: string | null;
  epicId: string | null;
  createdAt: number;
  resolvedAt: number | null;
  timeToResolutionMs: number | null;
  routedTo: string;
  stewardAttempts: number;
  suggestedAction: { bucket: string; confidence: number; rationale: string } | null;
  resolutionActor: string | null;
  recurrenceCount: number;
}

/** One decision record (the subset the timeline renders). Mirrors DecisionRecord. */
export interface DecisionRecordLite {
  id: string;
  kind: string;
  status: string;
  title: string;
  rationale: string | null;
  epicId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** The combined server payload the view fetches on open. */
export interface EscalationHistoryResponse {
  rows?: EscalationHistoryRow[];
  decisionRecords?: DecisionRecordLite[];
}

/** An escalation entry on the merged timeline, carrying its triage outcome. */
export interface EscalationTimelineEntry {
  type: 'escalation';
  id: string;
  /** Sort key: createdAt (when it was raised). */
  ts: number;
  kind: string;
  questionText: string;
  status: string;
  /** The shared triage lifecycle state (reused, not re-derived). */
  lifecycle: EscalationLifecycle;
  presentation: LifecyclePresentation;
  /** Who/what resolved it (decider handle | 'daemon-auto' | null while open). */
  resolutionActor: string | null;
  resolvedAt: number | null;
  /** Grok's rationale when an AI suggestion drove the outcome. */
  rationale: string | null;
  recurrenceCount: number;
}

/** A decision-record entry on the merged timeline. */
export interface DecisionTimelineEntry {
  type: 'decision';
  id: string;
  /** Sort key: createdAt. */
  ts: number;
  kind: string;
  status: string;
  title: string;
  rationale: string | null;
}

export type EpicTimelineEntry = EscalationTimelineEntry | DecisionTimelineEntry;

/**
 * Reconstruct the minimal Escalation fields classifyEscalationLifecycle needs from
 * a history row, then delegate — so the lifecycle state matches the live inbox for
 * the same escalation. The row lacks triageInFlight (a transient live-only flag) →
 * treated as not-in-flight, correct for a history view. resolvedBy is inferred from
 * routedTo: a resolved steward-routed escalation was the AI's auto-resolve; a
 * resolved human-routed one was a person.
 */
export function escalationRowLifecycle(row: EscalationHistoryRow): EscalationLifecycle {
  const open = row.status === 'open';
  const resolvedBy: 'ai' | 'human' | undefined = open
    ? undefined
    : row.routedTo === 'steward'
      ? 'ai'
      : 'human';
  const shim = {
    id: row.id,
    project: row.project,
    session: row.session,
    kind: row.kind,
    questionText: row.questionText,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    routedTo: row.routedTo,
    stewardAttempts: row.stewardAttempts,
    suggestedAction: row.suggestedAction
      ? {
          bucket: 'genuine-decision' as const,
          verb: null,
          confidence: row.suggestedAction.confidence,
          rationale: row.suggestedAction.rationale,
        }
      : null,
    triageInFlight: false,
    resolvedBy,
  } as unknown as Escalation;
  return classifyEscalationLifecycle(shim);
}

/** Map an escalation history row → a timeline entry (with reused lifecycle). */
export function toEscalationEntry(row: EscalationHistoryRow): EscalationTimelineEntry {
  const lifecycle = escalationRowLifecycle(row);
  return {
    type: 'escalation',
    id: row.id,
    ts: row.createdAt,
    kind: row.kind,
    questionText: row.questionText,
    status: row.status,
    lifecycle,
    presentation: presentationFor(lifecycle),
    resolutionActor: row.resolutionActor,
    resolvedAt: row.resolvedAt,
    rationale: row.suggestedAction?.rationale ?? null,
    recurrenceCount: row.recurrenceCount,
  };
}

/** Stable presentation for a lifecycle state (label + spinner) — mirrors
 *  lifecyclePresentation's switch, keyed by the already-classified state so the
 *  history view needn't reconstruct an Escalation just to label it. */
export function presentationFor(token: EscalationLifecycle): LifecyclePresentation {
  switch (token) {
    case 'ai-handling':
      return { token, label: 'Grok is triaging…', spinner: true };
    case 'ai-suggested':
      return { token, label: 'AI suggested', spinner: false };
    case 'escalated-to-human':
      return { token, label: 'Needs you — AI couldn’t resolve', spinner: false };
    case 'ai-resolved':
      return { token, label: 'AI resolved', spinner: false };
    case 'human-resolved':
      return { token, label: 'Resolved', spinner: false };
    case 'open':
    default:
      return { token: 'open', label: 'Open', spinner: false };
  }
}

/** Map a decision record → a timeline entry. */
export function toDecisionEntry(rec: DecisionRecordLite): DecisionTimelineEntry {
  return {
    type: 'decision',
    id: rec.id,
    ts: rec.createdAt,
    kind: rec.kind,
    status: rec.status,
    title: rec.title,
    rationale: rec.rationale,
  };
}

/**
 * Merge escalation rows + decision records into ONE chronological timeline.
 * Newest-first by default (most recent activity on top). Pure: no fetch, no React.
 */
export function buildEpicTimeline(
  resp: EscalationHistoryResponse | null | undefined,
  opts: { order?: 'asc' | 'desc' } = {},
): EpicTimelineEntry[] {
  const order = opts.order ?? 'desc';
  const rows = resp?.rows ?? [];
  const records = resp?.decisionRecords ?? [];
  const entries: EpicTimelineEntry[] = [
    ...rows.map(toEscalationEntry),
    ...records.map(toDecisionEntry),
  ];
  entries.sort((a, b) => (order === 'desc' ? b.ts - a.ts : a.ts - b.ts));
  return entries;
}

/** True when the epic has neither escalations nor decision records (empty state). */
export function isEmptyTimeline(timeline: EpicTimelineEntry[]): boolean {
  return timeline.length === 0;
}
