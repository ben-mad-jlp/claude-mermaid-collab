/**
 * ProposedBadge — the cross-mode confirm-loop depth pill (design-system-object-ui §3/§7).
 *
 * Rides the ModePill beside the escalation CommandBarBadge and is visible in ALL
 * modes: an AMBER `▲ N proposed` when the active project has requirements awaiting
 * a signature, hidden when the inbox is empty (no calm-tick — the inbox earning
 * its keep is silent until there's something to sign; one-red discipline keeps red
 * for escalations only).
 *
 * Reads the SAME selector (`selectInboxRequirements`) the RequirementsInbox lists
 * from, so the badge depth and the inbox can never disagree. Click → jump to
 * Bridge with the inbox in view.
 */

import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { selectInboxRequirements } from './requirementSelectors';

export const ProposedBadge: React.FC = () => {
  const requirementsByProject = useSupervisorStore((s) => s.requirementsByProject);
  const activeProjectPref = useUIStore((s) => s.activeProject);
  const currentProject = useSessionStore((s) => s.currentSession?.project) ?? null;
  const setMode = useUIStore((s) => s.setMode);

  const project = activeProjectPref ?? currentProject ?? '';
  const count = selectInboxRequirements(requirementsByProject[project] ?? [], project).length;

  if (count === 0) return null;

  return (
    <button
      type="button"
      data-testid="proposed-badge"
      data-proposed={count}
      onClick={() => setMode('bridge')}
      title={`${count} requirement${count === 1 ? '' : 's'} to sign — click to review`}
      className="flex items-center gap-1 px-1.5 py-0.5 text-3xs font-bold rounded-full bg-warning-500 hover:bg-warning-600 text-white leading-none transition-colors"
    >
      <span aria-hidden="true">▲</span>
      {count > 9 ? '9+' : count} proposed
    </button>
  );
};

export default ProposedBadge;
