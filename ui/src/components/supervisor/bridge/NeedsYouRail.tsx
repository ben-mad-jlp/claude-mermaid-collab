/**
 * NeedsYouRail — the top of the instrument panel and the SINGLE red owner of
 * the Bridge (BR-2, design §2/§8).
 *
 * When there are open escalations it renders them via the existing
 * BridgeEscalationInbox card logic (the only place red is earned). When the
 * inbox is empty it collapses to a calm, low-ink "all clear" line that gives
 * its space back to the rest of the panel rather than holding a big empty box.
 */

import React from 'react';
import type { Escalation } from '@/stores/supervisorStore';
import { BridgeEscalationInbox } from './BridgeEscalationInbox';

export interface NeedsYouRailProps {
  escalations: Escalation[];
  serverScope: string;
  /** Worker count for the calm "N workers nominal" line. */
  nominalCount: number;
  onJump?: (project: string, session: string) => void;
}

export const NeedsYouRail: React.FC<NeedsYouRailProps> = ({
  escalations,
  serverScope,
  nominalCount,
  onJump,
}) => {
  const open = escalations.filter((e) => e.status === 'open');

  if (open.length === 0) {
    return (
      <div
        data-testid="needs-you-rail"
        className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs text-gray-500 dark:text-gray-400"
      >
        <span className="text-success-500" aria-hidden="true">✓</span>
        <span>All clear · {nominalCount} worker{nominalCount === 1 ? '' : 's'} nominal</span>
      </div>
    );
  }

  return (
    <div data-testid="needs-you-rail">
      <BridgeEscalationInbox escalations={escalations} serverScope={serverScope} onJump={onJump} />
    </div>
  );
};

export default NeedsYouRail;
