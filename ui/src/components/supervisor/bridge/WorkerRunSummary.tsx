/**
 * WorkerRunSummary — the DURABLE, always-on "Worker run" record for a todo, sourced
 * from the append-only ledger via GET /api/worker-run (north-star §6). Unlike the live
 * LaneCallout (which only exists while a lane is in memory), this is shown whenever a
 * todo is selected and NO lane is live — so the phases that ran, on which model, at what
 * cost stay visible after the run ends and across a server restart.
 *
 * If the todo has never been worked, it renders a quiet empty state (the section is
 * still present — "nothing has run yet" rather than absent).
 */
import React, { useEffect, useState } from 'react';
import { PhasePipelineStrip, RECIPE_PHASES, PHASE_LABEL } from './fleet/PhasePipelineStrip';
import type { RecipePhase } from './fleet/PhasePipelineStrip';

interface PhaseRecord {
  phase: string;
  provider: string;
  model: string;
  source: string;
  usd: number;
  steps: number;
  ts: number;
}
interface WorkerRunResponse {
  todoId: string;
  ran: boolean;
  totalUsd: number;
  lastTs: number | null;
  phases: PhaseRecord[];
  byModel: Record<string, { rows: number; usd: number }>;
}

function fmtWhen(ts: number | null): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

export const WorkerRunSummary: React.FC<{ todoId: string; project: string }> = ({ todoId, project }) => {
  const [data, setData] = useState<WorkerRunResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ project, todoId });
    fetch(`/api/worker-run?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WorkerRunResponse | null) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [todoId, project]);

  const ranPhases = RECIPE_PHASES.filter((p) => data?.phases.some((r) => r.phase === p));
  const phaseById = new Map(data?.phases.map((r) => [r.phase, r]) ?? []);
  const models = Object.keys(data?.byModel ?? {});

  return (
    <div className="m-3 mb-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40">
      <div className="px-3 py-2 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">worker run</span>
        {data?.ran ? (
          <>
            <span className="text-2xs text-gray-500 dark:text-gray-400">ended · {fmtWhen(data.lastTs)}</span>
            <span className="ml-auto text-2xs tabular-nums font-semibold text-gray-700 dark:text-gray-200" title="total run cost">
              ${data.totalUsd.toFixed(4)}
            </span>
          </>
        ) : (
          <span className="ml-auto text-2xs text-gray-400 dark:text-gray-500 italic">
            {loading ? 'loading…' : 'not run yet'}
          </span>
        )}
      </div>

      {data?.ran && (
        <div className="px-3 py-2.5 space-y-2">
          <PhasePipelineStrip completed={ranPhases} />
          {/* Per-phase: model that ran it + spend (the durable routing record). */}
          <div className="space-y-0.5">
            {ranPhases.map((p) => {
              const r = phaseById.get(p)!;
              return (
                <div key={p} className="flex items-center gap-2 text-2xs">
                  <span className="text-gray-500 dark:text-gray-400 w-24 shrink-0">{PHASE_LABEL[p as RecipePhase]}</span>
                  <span className="text-gray-400 dark:text-gray-500 truncate flex-1" title={`${r.provider}/${r.model} · ${r.source}`}>
                    {r.provider}/{r.model}
                  </span>
                  <span className="tabular-nums text-gray-600 dark:text-gray-300 shrink-0">${r.usd.toFixed(3)}</span>
                </div>
              );
            })}
          </div>
          {models.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-3xs uppercase tracking-wide text-gray-400">routed via</span>
              {models.map((m) => (
                <span
                  key={m}
                  className="text-3xs font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {data && !data.ran && !loading && (
        <div className="px-3 py-3">
          <PhasePipelineStrip completed={[]} />
          <p className="mt-2 text-2xs text-gray-400 dark:text-gray-500 italic">
            No worker has run this todo yet.
          </p>
        </div>
      )}
    </div>
  );
};

export default WorkerRunSummary;
