/**
 * SplitDeck — the Bridge's root shell (BR-2 → Bridge P3, design §2/§8).
 *
 * Three columns: fixed-width rail on the left (ACT/WORK/TELEMETRY panels),
 * then a draggable split between stage (FleetGraph + PlanPanel) and inspector
 * (epic history / todo detail). CommandBar and Signals strip above the three
 * columns. The stage ↔ inspector split is horizontal and persisted.
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
            direction="horizontal"
            primaryContent={
              <div data-testid="split-stage" className="h-full min-h-0 w-full min-w-0 overflow-hidden flex flex-col">{stage}</div>
            }
            secondaryContent={
              <div data-testid="split-inspector" className="h-full min-h-0 w-full min-w-0 overflow-hidden">{inspector}</div>
            }
            defaultPrimarySize={72}
            minPrimarySize={40}
            maxPrimarySize={88}
            storageId="bridge-deck-split-c"
          />
        </div>
      </div>
    </div>
  );
};

export default SplitDeck;
