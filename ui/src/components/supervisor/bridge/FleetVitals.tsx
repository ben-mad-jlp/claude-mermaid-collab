/**
 * FleetVitals — the project's work funnel (Backlog ▸ Ready ▸ In-flight ▸ Blocked
 * ▸ Done) + spec-coverage glance. The coordinator on/off now lives in the
 * CommandBar role-switch line, so this is just Progress — no card chrome.
 * Blocked is the only segment allowed to go loud, and only while it has items.
 */

import React, { useState } from 'react';
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
  // Collapsible: the count header always shows; the per-branch list collapses.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div data-testid="fleet-vitals" className="space-y-3">
      {/* Progress funnel removed from the Bridge — it's redundant with the Plan
          view's progress. Only the non-redundant safety surfaces remain here:
          the unlanded-epic warning + the spec-coverage glance. */}

      {/* Unlanded-epic surface (design-epic-landing P1): accepted work stranded on
          collab/epic/* and not yet on master. Amber, NOT red (one-red: red is for
          escalations) — but impossible to miss. Uses the SAME amber as the project
          cards (card-pulse-amber + dark text, legible in both themes). Collapsible;
          self-hides when everything's landed. */}
      {unlanded.length > 0 && (
        <div data-testid="unlanded-epics" className="space-y-1 rounded-md border border-warning-400 card-pulse-amber p-2 text-black">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="w-full flex items-center gap-2 text-xs font-semibold text-black"
          >
            <span aria-hidden="true">⚠</span>
            <span>{unlanded.length} epic{unlanded.length === 1 ? '' : 's'} unlanded</span>
            <span className="font-normal text-gray-700">· {unlandedCommits} commit{unlandedCommits === 1 ? '' : 's'} off master</span>
            <svg
              className={`w-3 h-3 ml-auto text-gray-600 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {!collapsed && (
            <ul className="space-y-0.5">
              {unlanded.map((e) => (
                <li key={e.branch} className="flex items-center justify-between text-2xs text-gray-800 tabular-nums">
                  <span className="font-mono truncate">{e.branch}</span>
                  <span className="ml-2 shrink-0">+{e.ahead}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Spec coverage glance (§5) — self-hides when the project has no spec objects. */}
      <SpecCoverageCard coverage={coverage} />
    </div>
  );
};

export default FleetVitals;
