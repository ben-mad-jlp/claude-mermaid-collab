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
import { useSupervisorStore } from '@/stores/supervisorStore';
import { PhasePipelineStrip, RECIPE_PHASES, PHASE_LABEL } from './fleet/PhasePipelineStrip';
import type { RecipePhase } from './fleet/PhasePipelineStrip';
import { GrokTranscript } from '@/components/terminal/GrokTranscript';
import { TieringEditor } from '@/components/settings/TieringEditor';
import { WorkerRunStrip } from './WorkerRunStrip';
import { ProposedChangesCard } from './ProposedChangesCard';

/**
 * TodoWorkerPanel — the always-on worker section for a selected todo. Shows the LIVE
 * LaneCallout while a worker-fabric lane is running. The durable "what ran" record is the
 * headless WorkerRunStrip below (the deprecated tmux-worker WorkerRunSummary panel was removed).
 */
export const TodoWorkerPanel: React.FC<{
  todoId: string;
  project: string;
  serverId: string;
}> = ({ todoId, project, serverId }) => {
  const live = useWorkerFabricStore((s) => {
    const l = s.lanes[todoId];
    return !!l && l.alive && l.lifecycle !== 'end';
  });
  // Read the selected todo's status from the store (keeps the BridgeDashboard call site
  // unchanged) so the headless run strip can gate its poll on in_progress.
  const isActive = useSupervisorStore(
    (s) => (s.todosByProject[project] ?? []).find((t) => t.id === todoId)?.status === 'in_progress',
  );
  return (
    <>
      {live && <LaneCallout todoId={todoId} project={project} serverId={serverId} />}
      {/* Headless leaf-executor run (no lane / no session) — orthogonal source, always
          rendered (self-suppresses to a quiet placeholder when the todo never ran headless). */}
      <WorkerRunStrip leafId={todoId} isActive={isActive} />
      {/* Durable per-attempt blueprint manifest — the files the leaf proposes to create/edit.
          Sibling of WorkerRunStrip (compose, 00c8adb9); self-suppresses when no blueprint. */}
      <ProposedChangesCard leafId={todoId} project={project} />
    </>
  );
};

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
  const running = lane.alive && lane.lifecycle !== 'end';
  const activity = running && lane.phase ? PHASE_LABEL[lane.phase as RecipePhase] ?? 'Working' : 'Lane ended';
  const costPhases = RECIPE_PHASES.filter((p) => byPhase[p]);
  return (
    <div className="m-3 mb-0 rounded-lg border border-accent-200 dark:border-accent-800 bg-accent-50/50 dark:bg-accent-900/20 overflow-hidden">
      {/* Activity headline — the "what is this worker doing right now" line. */}
      <div className="px-3 py-2.5 border-b border-accent-200/60 dark:border-accent-800/60 flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${running ? 'bg-accent-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {activity}
            </span>
            {running && lane.route?.model && (
              <span
                className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
                title={lane.route.provider ? `${lane.route.provider} / ${lane.route.model}` : lane.route.model}
              >
                {lane.route.model}
              </span>
            )}
          </div>
          {running && lane.route?.source && (
            <div className="text-2xs text-gray-500 dark:text-gray-400 truncate">
              routed by {lane.route.source}
              {lane.route.winningScope ? ` · ${lane.route.winningScope}` : ''}
            </div>
          )}
        </div>
        <span className="shrink-0 text-2xs tabular-nums text-gray-600 dark:text-gray-300" title="run cost">
          ${lane.runCostUsd.toFixed(4)}
        </span>
        {running && lane.session && (
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
            className="shrink-0 text-2xs px-1.5 py-0.5 rounded bg-danger-50 text-danger-600 hover:bg-danger-100 dark:bg-danger-900/30 dark:text-danger-300"
          >
            ⏹ stop
          </button>
        )}
      </div>

      <div className="px-3 py-2.5 space-y-2">
        <PhasePipelineStrip current={lane.phase} lifecycle={lane.lifecycle} />
        {/* Per-phase spend breakdown (the WHERE of the run cost). */}
        {costPhases.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
            {costPhases.map((p) => (
              <span key={p} className="text-gray-500 dark:text-gray-400">
                {PHASE_LABEL[p]}{' '}
                <span className="tabular-nums text-gray-700 dark:text-gray-300">${byPhase[p].usd.toFixed(3)}</span>
              </span>
            ))}
          </div>
        )}
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
