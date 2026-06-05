/**
 * CommandBarBadge — the always-on escalation safety net (Bridge P1, ship FIRST).
 *
 * A single pill welded into the top mode chrome, visible in ALL modes
 * (studio/bridge/plan): a red `! N need you` when the active project has open
 * escalations, a calm green tick when it's all clear. It reads from the ONE
 * project-scoped selector (`selectOpenEscalations`) that also feeds the Z-rail,
 * the FleetGraph danger ring and the focal DecisionCard — so the badge count and
 * the graph's danger nodes can never disagree.
 *
 * Click → focus the highest open escalation: switch to the Bridge, open its
 * focal card and frame + pulse its graph node (graph-answers-the-card).
 */

import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useDeckStore } from '@/stores/deckStore';
import { selectOpenEscalations, highestPriorityEscalation, nodeIdForEscalation } from './escalationSelectors';

export const CommandBarBadge: React.FC = () => {
  const escalations = useSupervisorStore((s) => s.escalations);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const activeProjectPref = useUIStore((s) => s.activeProject);
  const currentProject = useSessionStore((s) => s.currentSession?.project) ?? null;
  const setMode = useUIStore((s) => s.setMode);
  const setFocalEscalationId = useDeckStore((s) => s.setFocalEscalationId);
  const setFocusNodeId = useDeckStore((s) => s.setFocusNodeId);

  const project = activeProjectPref ?? currentProject ?? '';
  const open = selectOpenEscalations(escalations, project);
  const count = open.length;

  const onClick = () => {
    const esc = highestPriorityEscalation(open);
    if (!esc) return;
    const nodeId = nodeIdForEscalation(esc, todosByProject[project] ?? []);
    // Frame the node in the Bridge graph (graph-answers-the-card).
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
