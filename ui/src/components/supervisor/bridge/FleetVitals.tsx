/**
 * FleetVitals — the project's work funnel (Backlog ▸ Ready ▸ In-flight ▸ Blocked
 * ▸ Done) + spec-coverage glance. The coordinator on/off now lives in the
 * CommandBar role-switch line, so this is just Progress — no card chrome.
 * Blocked is the only segment allowed to go loud, and only while it has items.
 */

import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import type { CoverageRollup, UnlandedEpic } from '@/stores/supervisorStore';
import { SpecCoverageCard } from './SpecCoverageCard';

export interface FleetVitalsProps {
  todos: SessionTodo[];
  /** Spec coverage rollup (design §5). Absent/empty → the card self-hides. */
  coverage?: CoverageRollup;
  /** Epics with commits stranded off master (design-epic-landing P1). When
   *  non-empty, an amber line surfaces the unlanded work so it's never invisible. */
  unlandedEpics?: UnlandedEpic[];
}

export const FleetVitals: React.FC<FleetVitalsProps> = ({ coverage, unlandedEpics }) => {
  const unlanded = unlandedEpics ?? [];
  const unlandedCommits = unlanded.reduce((n, e) => n + e.ahead, 0);

  return (
    <div data-testid="fleet-vitals" className="space-y-3">
      {/* Progress funnel removed from the Bridge — it's redundant with the Plan
          view's progress. Only the non-redundant safety surfaces remain here:
          the unlanded-epic warning + the spec-coverage glance. */}

      {/* Unlanded-epic surface (design-epic-landing P1): accepted work stranded on
          collab/epic/* and not yet on master. Amber, NOT red (one-red: red is for
          escalations) — but impossible to miss. Self-hides when everything's landed. */}
      {unlanded.length > 0 && (
        <div data-testid="unlanded-epics" className="space-y-1 rounded-md border border-warning-500/40 bg-warning-100 dark:bg-warning-900/30 p-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-warning-700 dark:text-warning-300">
            <span aria-hidden="true">⚠</span>
            <span>{unlanded.length} epic{unlanded.length === 1 ? '' : 's'} unlanded</span>
            <span className="font-normal text-warning-600 dark:text-warning-400">· {unlandedCommits} commit{unlandedCommits === 1 ? '' : 's'} off master</span>
          </div>
          <ul className="space-y-0.5">
            {unlanded.map((e) => (
              <li key={e.branch} className="flex items-center justify-between text-2xs text-warning-700 dark:text-warning-300 tabular-nums">
                <span className="font-mono truncate">{e.branch}</span>
                <span className="ml-2 shrink-0">+{e.ahead}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spec coverage glance (§5) — self-hides when the project has no spec objects. */}
      <SpecCoverageCard coverage={coverage} />
    </div>
  );
};

export default FleetVitals;
