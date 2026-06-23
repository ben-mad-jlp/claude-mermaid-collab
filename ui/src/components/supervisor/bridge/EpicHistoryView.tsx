/**
 * EpicHistoryView — per-epic Escalation & Decision history (todo b05125b6).
 *
 * Answers "what escalations/decisions happened on THIS epic and how were they
 * handled?". Unlike the open inbox (which drops items on resolve), this shows the
 * full trail: OPEN and RESOLVED escalations each with their triage outcome (the
 * shared EscalationLifecycle badge — AI-resolved with Grok's rationale vs
 * escalated-to-human vs human-resolved), the resolver, timestamps; folded in with
 * the epic's decision records, in one chronological list.
 *
 * Fetches ONCE on open (epicId/serverScope change) from
 * /api/supervisor/escalation-history?epicId= — which returns the escalation rows
 * AND the epic's decision records on the same response. No new WS event, no poll
 * (constraint b2fe36b1). Pure merge/sort/lifecycle lives in lib/epicHistory.ts.
 */

import React, { useEffect, useState } from 'react';
import {
  buildEpicTimeline,
  isEmptyTimeline,
  type EpicTimelineEntry,
  type EscalationHistoryResponse,
} from '@/lib/epicHistory';
import type { EscalationLifecycle } from '@/lib/escalationLifecycle';
import { useWorkerFabricStore } from '@/stores/workerFabricStore';
import { RECIPE_PHASES, PHASE_LABEL } from './fleet/PhasePipelineStrip';

export interface EpicHistoryViewProps {
  epicId: string;
  /** Human label for the epic (for the header). */
  epicLabel?: string;
  serverScope: string;
  project?: string;
}

/** Tint per lifecycle state — escalating heat for the unresolved/needs-you ones. */
const LIFECYCLE_BADGE: Record<EscalationLifecycle, string> = {
  open: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  'ai-handling': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'ai-suggested': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  'escalated-to-human': 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
  'ai-resolved': 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  'human-resolved': 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/**
 * EpicSpend — run-cost + routing rolled up across THIS epic's worker lanes
 * (the same fabric store the work-graph nodes read). Shows the epic total, lane
 * count, per-phase spend, and which models actually ran the phases (the routing).
 * Renders nothing until the epic has at least one lane with cost/activity.
 */
const EpicSpend: React.FC<{ epicId: string }> = ({ epicId }) => {
  const lanes = useWorkerFabricStore((s) => s.lanes);
  const roll = React.useMemo(() => {
    let total = 0;
    let live = 0;
    let laneCount = 0;
    const byPhase: Record<string, number> = {};
    const models = new Map<string, number>(); // "provider/model" → times seen as a phase route
    for (const l of Object.values(lanes)) {
      if (l.epicId !== epicId) continue;
      laneCount += 1;
      total += l.runCostUsd;
      if (l.alive) live += 1;
      for (const [phase, c] of Object.entries(l.byPhase ?? {})) {
        byPhase[phase] = (byPhase[phase] ?? 0) + c.usd;
      }
      if (l.route?.model) {
        const key = l.route.provider ? `${l.route.provider}/${l.route.model}` : l.route.model;
        models.set(key, (models.get(key) ?? 0) + 1);
      }
    }
    return { total, live, laneCount, byPhase, models };
  }, [lanes, epicId]);

  if (roll.laneCount === 0 || (roll.total <= 0 && roll.live === 0)) return null;
  const costPhases = RECIPE_PHASES.filter((p) => roll.byPhase[p]);
  return (
    <div className="rounded border border-accent-200 dark:border-accent-800 bg-accent-50/50 dark:bg-accent-900/20 p-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-400">
          Worker spend
        </span>
        {roll.live > 0 && (
          <span className="flex items-center gap-1 text-3xs text-accent-600 dark:text-accent-300">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse" />
            {roll.live} running
          </span>
        )}
        <span className="ml-auto text-2xs tabular-nums font-semibold text-gray-800 dark:text-gray-100" title="epic run cost">
          ${roll.total.toFixed(4)}
        </span>
      </div>
      <div className="mt-0.5 text-3xs text-gray-500 dark:text-gray-400">
        across {roll.laneCount} {roll.laneCount === 1 ? 'lane' : 'lanes'}
      </div>

      {costPhases.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
          {costPhases.map((p) => (
            <span key={p} className="text-gray-500 dark:text-gray-400">
              {PHASE_LABEL[p]}{' '}
              <span className="tabular-nums text-gray-700 dark:text-gray-300">${roll.byPhase[p].toFixed(3)}</span>
            </span>
          ))}
        </div>
      )}

      {roll.models.size > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-3xs uppercase tracking-wide text-gray-400">routed via</span>
          {[...roll.models.keys()].map((m) => (
            <span
              key={m}
              className="text-3xs font-medium px-1.5 py-0.5 rounded bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const EscalationRow: React.FC<{ entry: Extract<EpicTimelineEntry, { type: 'escalation' }> }> = ({ entry }) => (
  <div
    data-testid="epic-history-escalation"
    data-lifecycle={entry.lifecycle}
    className="rounded border border-gray-100 dark:border-gray-800 p-2"
  >
    <div className="flex items-center gap-1.5">
      <span className="text-3xs uppercase tracking-wide text-gray-400">{entry.kind}</span>
      <span
        className={`text-3xs font-medium px-1.5 py-0.5 rounded ${LIFECYCLE_BADGE[entry.lifecycle]}`}
      >
        {entry.presentation.spinner && (
          <span className="inline-block animate-spin mr-0.5">◌</span>
        )}
        {entry.presentation.label}
      </span>
      {entry.recurrenceCount > 1 && (
        <span className="text-3xs text-amber-600 dark:text-amber-400" title="recurred">
          ×{entry.recurrenceCount}
        </span>
      )}
      <span className="ml-auto text-3xs text-gray-400" title={fmtTime(entry.ts)}>
        {fmtTime(entry.ts)}
      </span>
    </div>
    <p className="mt-1 text-2xs text-gray-700 dark:text-gray-200 line-clamp-2">{entry.questionText}</p>
    {entry.rationale && (
      <p className="mt-0.5 text-3xs text-gray-500 dark:text-gray-400 italic">AI: {entry.rationale}</p>
    )}
    <div className="mt-1 flex items-center gap-2 text-3xs text-gray-400">
      {entry.resolutionActor && <span>by {entry.resolutionActor}</span>}
      {entry.resolvedAt != null && <span>resolved {fmtTime(entry.resolvedAt)}</span>}
    </div>
  </div>
);

const DecisionRow: React.FC<{ entry: Extract<EpicTimelineEntry, { type: 'decision' }> }> = ({ entry }) => (
  <div
    data-testid="epic-history-decision"
    className="rounded border border-gray-100 dark:border-gray-800 p-2"
  >
    <div className="flex items-center gap-1.5">
      <span className="text-3xs uppercase tracking-wide text-accent-500">decision · {entry.kind}</span>
      <span className="text-3xs px-1.5 py-0.5 rounded bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
        {entry.status}
      </span>
      <span className="ml-auto text-3xs text-gray-400" title={fmtTime(entry.ts)}>
        {fmtTime(entry.ts)}
      </span>
    </div>
    <p className="mt-1 text-2xs font-medium text-gray-800 dark:text-gray-100">{entry.title}</p>
    {entry.rationale && (
      <p className="mt-0.5 text-3xs text-gray-500 dark:text-gray-400">{entry.rationale}</p>
    )}
  </div>
);

export const EpicHistoryView: React.FC<EpicHistoryViewProps> = ({ epicId, epicLabel, serverScope, project }) => {
  const [timeline, setTimeline] = useState<EpicTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch ONCE per epic/scope (on open). No interval, no WS subscription.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const qs = new URLSearchParams({ epicId });
        if (project) qs.set('project', project);
        const path = `/api/supervisor/escalation-history?${qs.toString()}`;
        const mc = (window as any).mc;
        const body: EscalationHistoryResponse = mc?.invokeOnServer
          ? (await mc.invokeOnServer(serverScope, { path, method: 'GET' }))?.body
          : await (await fetch(path)).json();
        if (cancelled) return;
        setTimeline(buildEpicTimeline(body));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [epicId, serverScope, project]);

  return (
    <div data-testid="epic-history-view" className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          History
        </span>
        {epicLabel && <span className="text-2xs text-gray-700 dark:text-gray-200 truncate">· {epicLabel}</span>}
      </div>

      <EpicSpend epicId={epicId} />

      {loading && <p className="text-2xs text-gray-400 dark:text-gray-500 italic">Loading history…</p>}
      {!loading && error && <p className="text-2xs text-danger-500">{error}</p>}
      {!loading && !error && isEmptyTimeline(timeline) && (
        <p data-testid="epic-history-empty" className="text-2xs text-gray-400 dark:text-gray-500 italic">
          No escalations or decisions recorded for this epic yet.
        </p>
      )}
      {!loading &&
        !error &&
        timeline.map((entry) =>
          entry.type === 'escalation' ? (
            <EscalationRow key={`e:${entry.id}`} entry={entry} />
          ) : (
            <DecisionRow key={`d:${entry.id}`} entry={entry} />
          ),
        )}
    </div>
  );
};

export default EpicHistoryView;
