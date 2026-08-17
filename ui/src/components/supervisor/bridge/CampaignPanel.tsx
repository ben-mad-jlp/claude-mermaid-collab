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
import type { BridgeCampaign, BridgeCampaignLens } from '@/types/campaign';

export interface CampaignPanelProps {
  project: string;
  onOpenEntity?: (kind: string, id: string) => void;
}

/** Frozen empty array to avoid re-render on every store write. */
const EMPTY: BridgeCampaign[] = [];

/**
 * Check if a lens array represents a non-unanimous judgment.
 * True when verdicts differ OR any lens has changedVerdict === true.
 */
export function panelHasDissent(lenses: BridgeCampaignLens[]): boolean {
  if (lenses.length === 0) return false;

  // Check if any lens changed its verdict
  if (lenses.some((l) => l.changedVerdict)) return true;

  // Check if verdicts are unanimous
  const firstVerdict = lenses[0].verdict;
  return lenses.some((l) => l.verdict !== firstVerdict);
}

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
            <div className="px-2 space-y-2">
              {/* Ruling header */}
              <div className="space-y-1">
                <div className="text-3xs text-gray-600 dark:text-gray-400 font-semibold">
                  Ruling: {c.ruling.verdict}
                </div>
                <div className="text-3xs text-gray-500 dark:text-gray-500">
                  Judge: {c.ruling.judge}
                </div>
                <div className="text-3xs font-mono text-gray-500 dark:text-gray-500">
                  {c.ruling.ruledAtSha.slice(0, 8)}
                </div>
                {c.ruling.rationale !== null && (
                  <div className="text-3xs text-gray-500 dark:text-gray-400">
                    {c.ruling.rationale}
                  </div>
                )}
              </div>

              {/* Dissent marker */}
              {panelHasDissent(c.ruling.lenses) && (
                <div
                  data-testid="campaign-dissent"
                  className="text-3xs font-semibold text-amber-600 dark:text-amber-500"
                >
                  Dissent
                </div>
              )}

              {/* Per-lens rows */}
              {c.ruling.lenses.length > 0 && (
                <div className="space-y-1 pl-2 border-l border-gray-300 dark:border-gray-700">
                  {c.ruling.lenses.map((lens) => (
                    <div
                      key={lens.lens}
                      data-testid="campaign-lens"
                      className="text-3xs text-gray-600 dark:text-gray-400 space-y-0.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-600 dark:text-gray-400">
                          {lens.lens}
                        </span>
                        <span className="text-gray-500 dark:text-gray-500">
                          {lens.verdict}
                        </span>
                        <span className="text-gray-500 dark:text-gray-500">
                          ({lens.round})
                        </span>
                        {lens.changedVerdict && (
                          <span className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 rounded text-2xs">
                            changed
                          </span>
                        )}
                      </div>
                      {lens.reasoning !== null ? (
                        <div className="text-gray-500 dark:text-gray-500 pl-2">
                          {lens.reasoning}
                        </div>
                      ) : (
                        <div className="text-gray-400 dark:text-gray-600 pl-2 italic">
                          No reasoning recorded
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Examined block */}
              {c.ruling.artifactsRead.length > 0 && (
                <div className="space-y-0.5 pl-2 text-3xs text-gray-500 dark:text-gray-500">
                  <div className="font-semibold">Artifacts read:</div>
                  {c.ruling.artifactsRead.map((artifact, idx) => (
                    <div key={idx} className="pl-2 font-mono text-gray-600 dark:text-gray-400">
                      {artifact}
                    </div>
                  ))}
                </div>
              )}

              {c.ruling.commandsRun.length > 0 && (
                <div className="space-y-0.5 pl-2 text-3xs text-gray-500 dark:text-gray-500">
                  <div className="font-semibold">Commands run:</div>
                  {c.ruling.commandsRun.map((cmd, idx) => (
                    <div key={idx} className="pl-2 font-mono text-gray-600 dark:text-gray-400">
                      {cmd}
                    </div>
                  ))}
                </div>
              )}

              {c.ruling.citedLenses.length > 0 && (
                <div className="space-y-0.5 pl-2 text-3xs text-gray-500 dark:text-gray-500">
                  <div className="font-semibold">Cited lenses:</div>
                  {c.ruling.citedLenses.map((lens, idx) => (
                    <div key={idx} className="pl-2 font-mono text-gray-600 dark:text-gray-400">
                      {lens}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default CampaignPanel;
