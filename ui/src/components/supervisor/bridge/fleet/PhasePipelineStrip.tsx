/**
 * PhasePipelineStrip — the worker-core recipe phases as a compact strip
 * (design-worker-fabric-ui §5). Shared by the TodoNode decoration (compact) and the
 * LaneCallout (full). Shows the pipeline sizegate→…→review with the current phase lit;
 * only the running chip animates (motion = active work).
 */
import React from 'react';

export const RECIPE_PHASES = ['sizegate', 'research', 'authortests', 'implement', 'verify', 'review'] as const;
export type RecipePhase = (typeof RECIPE_PHASES)[number];

/** Human-readable phase names — the "what the worker is doing" verb. */
export const PHASE_LABEL: Record<RecipePhase, string> = {
  sizegate: 'Sizing',
  research: 'Researching',
  authortests: 'Authoring tests',
  implement: 'Implementing',
  verify: 'Verifying',
  review: 'Reviewing',
};

type PhaseState = 'done' | 'running' | 'pending';

function statesFor(current?: string, lifecycle?: 'start' | 'end'): Record<RecipePhase, PhaseState> {
  const idx = current ? RECIPE_PHASES.indexOf(current as RecipePhase) : -1;
  const out = {} as Record<RecipePhase, PhaseState>;
  for (let i = 0; i < RECIPE_PHASES.length; i++) {
    const p = RECIPE_PHASES[i];
    if (idx < 0) out[p] = 'pending';
    else if (i < idx) out[p] = 'done';
    else if (i === idx) out[p] = lifecycle === 'end' ? 'done' : 'running';
    else out[p] = 'pending';
  }
  return out;
}

const DOT: Record<PhaseState, string> = {
  done: 'bg-success-500',
  running: 'bg-accent-500 animate-pulse',
  pending: 'bg-gray-300 dark:bg-gray-600',
};
const CHIP: Record<PhaseState, string> = {
  done: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  running: 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300 animate-pulse',
  pending: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

export const PhasePipelineStrip: React.FC<{
  current?: string;
  lifecycle?: 'start' | 'end';
  compact?: boolean;
  /** Explicit "these phases ran" mode (a persisted/finished run has no single current
   *  phase). When provided, listed phases render done, the rest pending — overrides current. */
  completed?: readonly string[];
}> = ({ current, lifecycle, compact, completed }) => {
  const states = completed
    ? (Object.fromEntries(
        RECIPE_PHASES.map((p) => [p, completed.includes(p) ? 'done' : 'pending']),
      ) as Record<RecipePhase, PhaseState>)
    : statesFor(current, lifecycle);
  if (compact) {
    return (
      <div className="flex items-center gap-0.5" aria-label="phase pipeline">
        {RECIPE_PHASES.map((p) => (
          <span key={p} title={`${p}: ${states[p]}`} className={`h-1.5 w-1.5 rounded-full ${DOT[states[p]]}`} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 flex-wrap" aria-label="phase pipeline">
      {RECIPE_PHASES.map((p) => (
        <span
          key={p}
          title={`${PHASE_LABEL[p]}: ${states[p]}`}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CHIP[states[p]]}`}
        >
          {PHASE_LABEL[p]}
        </span>
      ))}
    </div>
  );
};

export default PhasePipelineStrip;
