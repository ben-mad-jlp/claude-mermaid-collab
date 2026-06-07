/**
 * CommandBarBadge — the always-on escalation safety net (Bridge P1, ship FIRST).
 *
 * A single pill welded into the top mode chrome, visible in ALL modes
 * (studio/bridge/plan): a red `! N need you` with the FLEET-WIDE open-escalation
 * total, a calm green tick when the whole fleet is clear. It counts via the ONE
 * roll-up path (`selectFleetOpenCount` ≡ `sum(selectOpenEscalationsByProject)`),
 * the same path that feeds the Project Rail badges — so the badge can never
 * disagree with the rail, and each project's count (`selectOpenEscalations`) is
 * equal to its rail badge by construction (FleetGraph danger-ring parity holds).
 *
 * Click → focus the fleet's highest-priority open escalation: switch to its
 * project + the Bridge, open its focal card and frame its graph node.
 */

import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useDeckStore } from '@/stores/deckStore';
import { selectFleetOpenCount, highestPriorityEscalation, nodeIdForEscalation } from './escalationSelectors';

export const CommandBarBadge: React.FC = () => {
  const escalations = useSupervisorStore((s) => s.escalations);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);
  const setMode = useUIStore((s) => s.setMode);
  const setFocalEscalationId = useDeckStore((s) => s.setFocalEscalationId);
  const setFocusNodeId = useDeckStore((s) => s.setFocusNodeId);

  const count = selectFleetOpenCount(escalations);

  const onClick = () => {
    const allOpen = escalations.filter((e) => e.status === 'open');
    const esc = highestPriorityEscalation(allOpen);
    if (!esc) return;
    const nodeId = nodeIdForEscalation(esc, todosByProject[esc.project] ?? []);
    // Switch to the escalation's project + Bridge and frame its node.
    setActiveProject(esc.project);
    setMode('bridge');
    setFocalEscalationId(esc.id);
    setFocusNodeId(nodeId);
  };

  if (count === 0) {
    return (
      <span
        data-testid="command-bar-badge"
        data-needs-you="0"
        title="All clear — no open escalations"
        className="flex items-center gap-1 px-1.5 py-0.5 text-3xs font-medium rounded-full bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300 leading-none"
      >
        <span aria-hidden="true">✓</span>
        all clear
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="command-bar-badge"
      data-needs-you={count}
      onClick={onClick}
      title={`${count} escalation${count === 1 ? '' : 's'} need you — click to focus`}
      className="flex items-center gap-1 px-1.5 py-0.5 text-3xs font-bold rounded-full bg-danger-500 hover:bg-danger-600 text-white leading-none transition-colors"
    >
      <span aria-hidden="true">!</span>
      {count > 9 ? '9+' : count} need you
    </button>
  );
};

export default CommandBarBadge;
