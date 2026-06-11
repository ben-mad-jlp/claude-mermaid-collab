/**
 * CommandBarBadge — the always-on escalation safety net (Bridge P1, ship FIRST).
 *
 * A single pill welded into the top mode chrome, visible in ALL modes
 * (studio/bridge/plan): a red `! N need you` with the FLEET-WIDE open-escalation
 * total, a calm green tick when the whole fleet is clear. It counts via the ONE
 * shared selector (`selectOpenEscalationCount(open, {fleet})` from statusSelectors),
 * the same selector the Project Rail badges/zones use at a narrower scope — so the
 * badge can never disagree with the rail; a fleet badge differs from a project
 * badge only by its explicit scope, never by an accidental drift.
 *
 * Click → focus the fleet's highest-priority open escalation: switch to its
 * project + the Bridge, open its focal card and frame its graph node.
 */

import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useDeckStore } from '@/stores/deckStore';
import { highestPriorityEscalation, nodeIdForEscalation } from './escalationSelectors';
import { selectOpenEscalations, selectOpenEscalationCount } from '@/lib/statusSelectors';

export const CommandBarBadge: React.FC = () => {
  // Coherence: read the open slice through the shared scoped selector (fleet),
  // the SAME selector the Project Rail/zones use — so the badge can never drift.
  const openEscalations = useSupervisorStore((s) => s.openEscalations);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);
  const setMode = useUIStore((s) => s.setMode);
  const setFocalEscalationId = useDeckStore((s) => s.setFocalEscalationId);
  const setFocusNodeId = useDeckStore((s) => s.setFocusNodeId);

  const count = selectOpenEscalationCount(openEscalations, { kind: 'fleet' });

  const onClick = () => {
    const allOpen = selectOpenEscalations(openEscalations, { kind: 'fleet' });
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
