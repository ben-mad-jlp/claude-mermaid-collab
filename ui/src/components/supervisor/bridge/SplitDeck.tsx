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
import { SplitPane } from '@/components/layout/SplitPane';

export interface SplitDeckProps {
  commandBar: React.ReactNode;
  signals?: React.ReactNode;   // SignalsStrip (zero-height when idle)
  rail: React.ReactNode;       // BridgeRail — fixed 296px, sizes itself
  stage: React.ReactNode;      // BridgeStage
  inspector: React.ReactNode;  // BridgeInspector
}

export const SplitDeck: React.FC<SplitDeckProps> = ({ commandBar, signals, rail, stage, inspector }) => {
  return (
    <div data-testid="bridge-split-deck" className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      <div className="shrink-0">{commandBar}</div>
      {signals && <div className="shrink-0">{signals}</div>}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-row">
        {rail}
        <div className="flex-1 min-w-0 min-h-0">
          <SplitPane
            direction="vertical"
            primaryContent={
              <div data-testid="split-stage" className="h-full min-h-0 w-full min-w-0 overflow-hidden flex flex-col">{stage}</div>
            }
            secondaryContent={
              <div data-testid="split-inspector" className="h-full min-h-0 w-full min-w-0 overflow-hidden">{inspector}</div>
            }
            defaultPrimarySize={65}
            minPrimarySize={30}
            maxPrimarySize={85}
            storageId="bridge-deck-split-v1"
          />
        </div>
      </div>
    </div>
  );
};

export default SplitDeck;
