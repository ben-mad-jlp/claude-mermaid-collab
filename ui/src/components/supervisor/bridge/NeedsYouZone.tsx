/**
 * NeedsYouZone (Z1) — the top-priority escalation zone (Bridge P2).
 *
 * Lifts the BridgeEscalationInbox decision cards OUT of the NeedsYouRail into a
 * wrapper that is FIRST-IN-DOM in the instrument column and ALWAYS visible:
 * `sticky top-0` pins it to the top of the scrolling left column (sticky-top on
 * narrow, pinned top-of-column on wide) so the "needs you" cards can never be
 * scrolled away. Empty state is a calm tick.
 *
 * It derives its set from the SAME P1 selector (`selectOpenEscalations`) that
 * feeds the CommandBarBadge and the FleetGraph danger ring, so the red count in
 * the zone, the badge and the graph rings stay in lockstep (parity).
 *
 * P2 only LIFTS — the rail is not deleted yet (that's P4); the rail keeps its
 * calm all-clear line. Only this zone mounts the inbox, so the inbox's window
 * keyboard handler is never double-bound.
 */

import React from 'react';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';
import type { SessionTodo } from '@/types/sessionTodo';
import { selectOpenEscalations } from '@/lib/statusSelectors';
import { selectRecentlyAiResolved } from '@/lib/escalationLifecycle';
import { BridgeEscalationInbox } from './BridgeEscalationInbox';

export interface NeedsYouZoneProps {
  /** Full escalation list — scoped here via the shared selector. */
  escalations: Escalation[];
  project: string;
  serverScope: string;
  onJump?: (project: string, session: string) => void;
  /** Open an escalation's linked todo in the detail tab. */
  onSelectTodo?: (todo: SessionTodo) => void;
  /** Render body-only (no card chrome / header) for use inside a tab panel. */
  embedded?: boolean;
}

export const NeedsYouZone: React.FC<NeedsYouZoneProps> = ({
  escalations,
  project,
  serverScope,
  onJump,
  onSelectTodo,
  embedded,
}) => {
  const open = selectOpenEscalations(escalations, { kind: 'project', project });

  // Keep the zone mounted while a recently AI-resolved escalation is still
  // lingering for this project (fd934fb7) — otherwise the "All clear" branch would
  // unmount the inbox and the AI-resolved outcome would vanish, the very thing the
  // lingering card exists to prevent.
  const resolvedEscalations = useSupervisorStore((s) => s.resolvedEscalations);
  const hasLingeringAiResolved =
    selectRecentlyAiResolved(
      resolvedEscalations.filter((e) => e.project === project),
      Date.now(),
    ).length > 0;

  const body =
    open.length === 0 && !hasLingeringAiResolved ? (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-success-500" aria-hidden="true">✓</span>
        <span>All clear — nothing needs you</span>
      </div>
    ) : (
      <BridgeEscalationInbox escalations={open} serverScope={serverScope} onJump={onJump} project={project} onSelectTodo={onSelectTodo} />
    );

  if (embedded) return <div data-testid="needs-you-zone" data-needs-you={open.length}>{body}</div>;

  return (
    <div
      data-testid="needs-you-zone"
      data-needs-you={open.length}
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-[8rem] max-h-56"
    >
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs">
        <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Escalations</span>
        {open.length > 0 && <span className="text-danger-600 dark:text-danger-400 font-bold">{open.length}</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">{body}</div>
    </div>
  );
};

export default NeedsYouZone;
