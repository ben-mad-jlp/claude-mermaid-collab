/**
 * LaneCallout — the worker-fabric drill-in for a selected todo's live lane
 * (design-worker-fabric-ui §2/§6.8(4)). Renders above the todo detail when the
 * selected todo has an in-process worker lane: the full phase pipeline with per-
 * phase model + cost, the run total, the routing decision, and the reused live
 * GrokTranscript. Renders nothing when the todo has no lane (byte-identical for
 * non-fabric todos). The Stop control + tiering-in-context land in L6/L7.
 */
import React from 'react';
import { useWorkerFabricStore } from '@/stores/workerFabricStore';
import { PhasePipelineStrip, RECIPE_PHASES } from './fleet/PhasePipelineStrip';
import { GrokTranscript } from '@/components/terminal/GrokTranscript';
import { TieringEditor } from '@/components/settings/TieringEditor';

export const LaneCallout: React.FC<{
  todoId: string;
  project: string;
  serverId: string;
}> = ({ todoId, project, serverId }) => {
  const lane = useWorkerFabricStore((s) => s.lanes[todoId]);
  const [showTranscript, setShowTranscript] = React.useState(false);
  const [showTiering, setShowTiering] = React.useState(false);
  if (!lane) return null;

  const byPhase = lane.byPhase ?? {};
  return (
    <div className="m-3 mb-0 rounded-lg border border-accent-200 dark:border-accent-800 bg-accent-50/50 dark:bg-accent-900/20">
      <div className="px-3 py-2 border-b border-accent-200/60 dark:border-accent-800/60 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-accent-500">worker lane</span>
        {lane.alive ? (
          <span className="flex items-center gap-1 text-2xs text-accent-600 dark:text-accent-300">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse" /> running
          </span>
        ) : (
          <span className="text-2xs text-gray-400">ended</span>
        )}
        <span className="ml-auto text-2xs tabular-nums text-gray-600 dark:text-gray-300" title="run cost">
          ${lane.runCostUsd.toFixed(4)}
        </span>
        {lane.alive && lane.session && (
          <button
            type="button"
            title="Stop this worker lane (aborts the run)"
            onClick={async () => {
              await fetch('/api/worker-lane/abort', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: lane.session }),
              }).catch(() => {});
            }}
            className="text-2xs px-1.5 py-0.5 rounded bg-danger-50 text-danger-600 hover:bg-danger-100 dark:bg-danger-900/30 dark:text-danger-300"
          >
            ⏹ stop
          </button>
        )}
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <PhasePipelineStrip current={lane.phase} lifecycle={lane.lifecycle} />
        {/* Per-phase model + cost captions (the WHY of routing + spend). */}
        <div className="grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 text-[10px]">
          {RECIPE_PHASES.filter((p) => byPhase[p] || p === lane.phase).map((p) => (
            <React.Fragment key={p}>
              <span className="text-gray-500 dark:text-gray-400">{p}</span>
              <span className="text-gray-400 truncate">
                {p === lane.phase && lane.route?.model
                  ? `${lane.route.provider}/${lane.route.model} (${lane.route.source}${lane.route.winningScope ? ':' + lane.route.winningScope : ''})`
                  : ''}
              </span>
              <span className="tabular-nums text-gray-500 dark:text-gray-400 text-right">
                {byPhase[p] ? `$${byPhase[p].usd.toFixed(3)}` : ''}
              </span>
            </React.Fragment>
          ))}
        </div>
        {/* Tiering-in-context (design graft): tune which model runs each phase, scoped
            to this lane's project, right where the routing is shown. */}
        <button
          type="button"
          onClick={() => setShowTiering((v) => !v)}
          className="text-2xs text-accent-600 dark:text-accent-400 hover:underline"
        >
          {showTiering ? '▾ hide model routing' : '⚙ model routing'}
        </button>
        {showTiering && (
          <div className="mt-1 rounded border border-gray-200 dark:border-gray-700 p-2 bg-white/60 dark:bg-gray-900/40">
            <TieringEditor
              scope="project"
              scopeId={project}
              previewParams={{ project, epicId: lane.epicId }}
            />
          </div>
        )}
      </div>

      {lane.session && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-2xs text-accent-600 dark:text-accent-400 hover:underline"
          >
            {showTranscript ? '▾ hide transcript' : '▸ live transcript'}
          </button>
          {showTranscript && (
            <div className="mt-1 h-48 rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
              <GrokTranscript project={project} session={lane.session} serverId={serverId} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LaneCallout;
