/**
 * SplitDeck — the Bridge's root shell (BR-2 → Bridge P3, design §2/§8).
 *
 * A CommandBar across the top, then a single draggable <SplitPane> that REFLOWS
 * by viewport: on lg+ the instrument column and the graph sit side-by-side
 * (horizontal split, graph laid out LR); below 1024px they stack — instrument
 * column over graph (vertical split, graph TB). The divider is draggable in both
 * orientations and its ratio persists PER ORIENTATION (separate storageIds).
 *
 * Both panes are ALWAYS mounted (one SplitPane, no CSS show/hide and no
 * Panel|Graph tab toggle) — the old toggle could hide an open escalation in the
 * inactive tab, the documented worst case. The orientation flip is a JS state
 * change on the same tree, so the subscription-bearing FleetGraph is never
 * double-mounted and never remounted on flip.
 */

import React from 'react';
import { SplitPane } from '@/components/layout/SplitPane';
import { useIsDesktop } from '@/hooks/useIsDesktop';

export interface SplitDeckProps {
  commandBar: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
}

export const SplitDeck: React.FC<SplitDeckProps> = ({ commandBar, left, right }) => {
  const isDesktop = useIsDesktop();
  const direction = isDesktop ? 'horizontal' : 'vertical';
  // Per-orientation persisted ratio so resizing wide doesn't clobber the narrow
  // split and vice-versa. SplitPane reads autoSaveId, so the id carries the axis.
  const storageId = isDesktop ? 'bridge-deck-split-h' : 'bridge-deck-split-v';

  const leftPane = (
    <div data-testid="split-left" className="h-full min-h-0 overflow-y-auto w-full">
      <div className="flex flex-col gap-3 p-3 w-full">{left}</div>
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
          defaultPrimarySize={38}
          minPrimarySize={25}
          maxPrimarySize={60}
          storageId={storageId}
        />
      </div>
    </div>
  );
};

export default SplitDeck;
