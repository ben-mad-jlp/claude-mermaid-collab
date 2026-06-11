/**
 * SplitDeck — the Bridge's root shell (BR-2 → Bridge P3, design §2/§8).
 *
 * A CommandBar across the top, then a single draggable <SplitPane> that ALWAYS
 * stacks vertically: the instrument zones on top, the FleetGraph as a full-width
 * strip at the bottom (graph laid out TB). The full width suits the dependency
 * graph and removes the wasted space the old side-by-side split left below the
 * short instrument column. The horizontal bar divider is draggable; its ratio
 * persists.
 *
 * Both panes are ALWAYS mounted (one SplitPane, no CSS show/hide and no
 * Panel|Graph tab toggle) — the old toggle could hide an open escalation in the
 * inactive tab, the documented worst case.
 */

import React from 'react';
import { SplitPane } from '@/components/layout/SplitPane';

export interface SplitDeckProps {
  commandBar: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
}

export const SplitDeck: React.FC<SplitDeckProps> = ({ commandBar, left, right }) => {
  const direction = 'vertical' as const;
  const storageId = 'bridge-deck-split-v';

  const leftPane = (
    <div data-testid="split-left" className="h-full min-h-0 overflow-y-auto w-full">
      <div className="flex flex-col gap-3 p-3 w-full min-h-full">{left}</div>
    </div>
  );
  const rightPane = (
    <div data-testid="split-right" className="h-full min-h-0 w-full overflow-hidden">
      {right}
    </div>
  );

  return (
    <div data-testid="bridge-split-deck" className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      <div className="shrink-0">{commandBar}</div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <SplitPane
          // direction + storageId are passed dynamically (NOT via a remounting
          // `key`) so the orientation flip never tears down the FleetGraph; the
          // PanelGroup re-applies the axis and the per-orientation saved ratio
          // in place.
          direction={direction}
          primaryContent={leftPane}
          secondaryContent={rightPane}
          defaultPrimarySize={45}
          minPrimarySize={20}
          maxPrimarySize={75}
          storageId={storageId}
        />
      </div>
    </div>
  );
};

export default SplitDeck;
