/**
 * CampaignStrip — a thin, clickable summary of live campaigns in the Bridge.
 *
 * Renders a glanceable strip showing active campaigns with probe pass counts,
 * chamber outcomes, and linked mission nicknames. Clicking opens the full
 * campaign panel in the stage. No self-fetch; data flows only through the
 * supervisor store (Bridge snapshot).
 */

import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';

export interface CampaignStripProps {
  project: string;
  onOpenCampaigns: () => void;
}

/** Stable empty array fallback — avoids re-render on every store write. */
const EMPTY: BridgeCampaign[] = [];

export const CampaignStrip: React.FC<CampaignStripProps> = ({ project, onOpenCampaigns }) => {
  const campaigns = useSupervisorStore((s) => s.campaignsByProject[project]) ?? EMPTY;

  // Filter to only live campaigns (droppedAt == null covers absent-field legacy snapshots)
  const live = campaigns.filter((c) => c.droppedAt == null);

  if (live.length === 0) return null;

  return (
    <div
      data-testid="campaign-strip"
      className="px-3 py-1.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 space-y-0.5"
    >
      {live.map((c) => (
        <button
          type="button"
          key={c.id}
          data-testid="campaign-strip-line"
          onClick={onOpenCampaigns}
          title="Open campaigns"
          className="flex w-full items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
        >
          {/* Campaign title */}
          <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 min-w-0 truncate">
            {c.title}
          </span>

          {/* Probe pass counts */}
          <span className="text-2xs font-mono tabular-nums text-gray-600 dark:text-gray-400 shrink-0">
            {`${c.probes.filter((p) => p.verdict === 'pass').length}/${c.probes.length}`}
          </span>

          {/* Chamber outcome (if present) */}
          {c.chamber && (
            <span className="text-2xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
              {c.chamber.outcome}
            </span>
          )}

          {/* Linked mission nickname (if present) */}
          {c.linkedMissions?.[0]?.nickname && (
            <span className="text-2xs text-gray-600 dark:text-gray-400 min-w-0 truncate shrink-0">
              {c.linkedMissions[0].nickname}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default CampaignStrip;
