/**
 * CampaignPanel — store-fed campaign surface rendering title/goal/probe rows.
 *
 * Pure reader component: campaigns arrive only through the bridge snapshot's
 * campaignsByProject store state. No self-fetch, no interval polling, no websocket.
 *
 * Renders campaign title (optional click handler), goal (with muted null placeholder),
 * and one row per probe showing id prefix, kind, environment and verdict.
 */

import React, { useMemo } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';

export interface CampaignPanelProps {
  project: string;
  onOpenEntity?: (kind: string, id: string) => void;
}

/** Frozen empty array to avoid re-render on every store write. */
const EMPTY: BridgeCampaign[] = [];

export const CampaignPanel: React.FC<CampaignPanelProps> = ({ project, onOpenEntity }) => {
  const campaigns = useSupervisorStore((s) => s.campaignsByProject[project]) ?? EMPTY;

  const isEmpty = useMemo(() => campaigns.length === 0, [campaigns.length]);

  if (isEmpty) {
    return (
      <div className="p-4 text-sm text-gray-400 dark:text-gray-500">
        No campaigns for this project.
      </div>
    );
  }

  return (
    <div className="p-2 space-y-3">
      {campaigns.map((c) => (
        <div key={c.id} className="space-y-1">
          {/* Campaign heading with optional click handler */}
          {onOpenEntity ? (
            <button
              type="button"
              onClick={() => onOpenEntity('campaign', c.id)}
              className="text-left font-semibold text-sm text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              {c.title}
            </button>
          ) : (
            <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">
              {c.title}
            </div>
          )}

          {/* Goal line with null placeholder */}
          <div className="px-2 text-3xs text-gray-400 dark:text-gray-500">
            {c.goal === null ? 'No goal recorded' : c.goal}
          </div>

          {/* Probe rows */}
          {c.probes.length > 0 && (
            <div className="space-y-0.5 pl-2">
              {c.probes.map((probe) => (
                <div
                  key={probe.id}
                  className="flex items-center gap-2 text-2xs text-gray-600 dark:text-gray-400 font-mono"
                >
                  <span className="shrink-0 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    {probe.id.slice(0, 8)}
                  </span>
                  <span className="shrink-0">{probe.kind}</span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-500">
                    {probe.environment}
                  </span>
                  <span className="shrink-0">{probe.verdict}</span>
                </div>
              ))}
            </div>
          )}

          {/* Ruling verdict if present */}
          {c.ruling && (
            <div className="px-2 text-3xs text-gray-500 dark:text-gray-400">
              Ruling: {c.ruling.verdict}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default CampaignPanel;
