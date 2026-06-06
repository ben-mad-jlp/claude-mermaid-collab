/**
 * ConstraintPeerChips (Planner graft, design-system-object-ui §5) — surfaces the
 * project's CONFIRMED requirements as constraint-PEER chips in the planner
 * orientation: the literal rendering of the active-requirements promise set
 * beside where active constraints read. A requirement is a *promise* — a
 * {metric · op · target} chip (the shared RequirementChip atom) — so it looks
 * identical everywhere it appears.
 *
 * These chips are READ-ONLY orientation (the rail guides, the kanban authors —
 * the anti-duplication wall): they DO NOT author plan items and carry no mutation.
 * The satisfy-drag gesture that links a kanban todo to a requirement is a separate
 * follow-up (gated on the todo↔object edge contract); nothing here writes edges.
 *
 * Derives from the existing supervisor store — loadRequirements (leaf G's
 * GET /api/supervisor/requirements) on mount/scope-change, scoped to confirmed
 * (approved/active) via selectConfirmedRequirements. No new endpoint, no WS.
 */
import React, { useEffect, useMemo } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { RequirementChip } from './bridge/RequirementChip';
import { selectConfirmedRequirements } from './bridge/requirementSelectors';

export interface ConstraintPeerChipsProps {
  serverId: string;
  project: string;
}

export const ConstraintPeerChips: React.FC<ConstraintPeerChipsProps> = ({ serverId, project }) => {
  const requirementsByProject = useSupervisorStore((s) => s.requirementsByProject);
  const loadRequirements = useSupervisorStore((s) => s.loadRequirements);

  useEffect(() => {
    if (serverId && project) void loadRequirements(serverId, project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, project]);

  const chips = useMemo(
    () => selectConfirmedRequirements(requirementsByProject[project] ?? [], project),
    [requirementsByProject, project],
  );

  // Calm absence: render nothing when there are no confirmed promises — the
  // planner orientation stays uncluttered until requirements are committed.
  if (chips.length === 0) return null;

  return (
    <div
      data-testid="constraint-peer-chips"
      data-count={chips.length}
      className="shrink-0 flex items-center gap-1.5 flex-wrap px-4 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40"
    >
      <span className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        Requirements
      </span>
      {chips.map((r) => (
        <RequirementChip key={r.id} spec={r.spec} fallback={r.title} />
      ))}
    </div>
  );
};

export default ConstraintPeerChips;
