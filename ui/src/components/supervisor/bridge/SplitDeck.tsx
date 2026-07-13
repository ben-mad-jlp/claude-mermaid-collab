/**
 * SplitDeck — the Bridge's root shell (BR-2 → Bridge P3, design §2/§8).
 *
 * A fixed-width rail on the left (ACT/WORK/TELEMETRY panels) sits beside a single
 * work column. Inside that column the stage (FleetGraph + PlanPanel) is stacked
 * ABOVE the inspector (epic history / todo detail), separated by a draggable
 * horizontal divider. The stage ↔ inspector split is vertical and persisted.
 * CommandBar and Signals strip sit above both columns.
 */

import React from 'react';

export interface SplitDeckProps {
  commandBar: React.ReactNode;
  signals?: React.ReactNode;   // SignalsStrip (zero-height when idle)
  rail: React.ReactNode;       // BridgeRail — fixed 296px, sizes itself
  unlandedStrip?: React.ReactNode;  // unlandedStrip slot (optional)
  missionStrip?: React.ReactNode;   // missionStrip slot (optional)
  stage: React.ReactNode;      // BridgeStage
  inspector: React.ReactNode;  // BridgeInspector
  inspectorOpen: boolean;      // Gates inspector drawer visibility
  onInspectorClose?: () => void; // Dismiss the drawer
}

export const SplitDeck: React.FC<SplitDeckProps> = ({
  commandBar,
  signals,
  rail,
  unlandedStrip,
  missionStrip,
  stage,
  inspector,
  inspectorOpen,
  onInspectorClose,
}) => {
  return (
    <div data-testid="bridge-split-deck" className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      <div className="shrink-0">{commandBar}</div>
      {signals && <div className="shrink-0">{signals}</div>}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-row">
        {rail}
        <div className="flex-1 min-w-0 min-h-0 relative flex flex-col">
          {unlandedStrip && <div data-testid="split-unlanded-strip" className="shrink-0">{unlandedStrip}</div>}
          {missionStrip && <div data-testid="split-mission-strip" className="shrink-0">{missionStrip}</div>}
          <div data-testid="split-stage" className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">{stage}</div>
          {inspectorOpen && (
            <div data-testid="split-inspector" className="absolute inset-y-0 right-0 w-[420px] max-w-full min-h-0 overflow-y-auto z-20 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl">
              {onInspectorClose && (
                <button
                  type="button"
                  data-testid="split-inspector-close"
                  aria-label="Close inspector"
                  onClick={onInspectorClose}
                  className="absolute top-1 right-1 z-10 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  ×
                </button>
              )}
              {inspector}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SplitDeck;
