/**
 * FleetVitals — the project's work funnel (Backlog ▸ Ready ▸ In-flight ▸ Blocked
 * ▸ Done) + spec-coverage glance. The coordinator on/off now lives in the
 * CommandBar role-switch line, so this is just Progress — no card chrome.
 * Blocked is the only segment allowed to go loud, and only while it has items.
 */

import React from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import type { CoverageRollup, UnlandedEpic } from '@/stores/supervisorStore';
import { SpecCoverageCard } from './SpecCoverageCard';

export interface FleetVitalsProps {
  todos: SessionTodo[];
  /** Spec coverage rollup (design §5). Absent/empty → the card self-hides. */
  coverage?: CoverageRollup;
  /** Retained for the caller/test contract; the unlanded surface now lives in
   *  UnlandedStrip, so this component no longer renders it. */
  unlandedEpics?: UnlandedEpic[];
}

export const FleetVitals: React.FC<FleetVitalsProps> = ({ coverage }) => {
  return (
    <div data-testid="fleet-vitals" className="space-y-3">
      {/* Spec coverage glance (§5) — self-hides when the project has no spec objects. */}
      <SpecCoverageCard coverage={coverage} />
    </div>
  );
};

export default FleetVitals;
