/**
 * CampaignPanel — store-fed campaign surface rendering title/goal/probe rows.
 *
 * Pure reader component: campaigns arrive only through the bridge snapshot's
 * campaignsByProject store state. No self-fetch, no interval polling, no websocket.
 *
 * Renders campaign title (optional click handler), goal (with muted null placeholder),
 * and one row per probe showing id prefix, kind, environment and verdict.
 */

import React, { useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign, BridgeCampaignLens, BridgeChamberEntry, ChamberRosterEntry } from '@/types/campaign';

export interface CampaignPanelProps {
  project: string;
  onOpenEntity?: (kind: string, id: string) => void;
  nowMs?: number;
}

/**
 * Probe evidence older than this threshold is marked as stale.
 * (A probe whose evidence predates a day of trunk movement is no longer a live measurement.)
 */
export const PROBE_EVIDENCE_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Chamber entry bodies longer than this character count are clamped and can be expanded.
 */
export const CHAMBER_CLAMP_CHARS = 280;

/** Frozen empty array to avoid re-render on every store write. */
const EMPTY: BridgeCampaign[] = [];

/**
 * Render a chamber role with its optional roster agenda description.
 * The role is rendered in its own <span> to preserve test assertions like
 * screen.getByText('lens-security'). The agenda (if present) renders in a sibling
 * muted element with data-testid="chamber-role-agenda".
 */
const ChamberRole: React.FC<{ role: string; agenda: string | null }> = ({ role, agenda }) => (
  <div className="flex items-center gap-2">
    <span className="font-mono">{role}</span>
    {agenda !== null && (
      <span
        data-testid="chamber-role-agenda"
        title={agenda}
        className="text-gray-400 dark:text-gray-500"
      >
        {agenda}
      </span>
    )}
  </div>
);

/**
 * Render a chamber body with automatic clamping and expand control.
 * Short bodies (≤ CHAMBER_CLAMP_CHARS) render unchanged.
 * Long bodies render clamped by default with a Show more/Show less button.
 */
const ClampedBody: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);

  if (text.length <= CHAMBER_CLAMP_CHARS) {
    return <div className="text-gray-500 dark:text-gray-500">{text}</div>;
  }

  const truncated = text.slice(0, CHAMBER_CLAMP_CHARS) + '…';

  return (
    <>
      <div
        data-testid="chamber-body"
        data-clamped={expanded ? 'false' : 'true'}
        className="text-gray-500 dark:text-gray-500"
      >
        {expanded ? text : truncated}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors text-2xs mt-1"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </>
  );
};

/**
 * Format a probe's last evidence timestamp into a relative-age label.
 * Returns the age label, whether it is considered stale (>= 24 hours old),
 * and whether the probe has never run.
 */
export function formatProbeAge(
  lastEvidenceAt: number | null,
  nowMs: number
): { label: string; stale: boolean; neverRan: boolean } {
  if (lastEvidenceAt === null) {
    return { label: 'never ran', stale: false, neverRan: true };
  }

  const ageMs = Math.max(0, nowMs - lastEvidenceAt);
  const stale = ageMs >= PROBE_EVIDENCE_STALE_MS;

  // Relative time formatting: same buckets as ConductorLadder.tsx:40-49
  const s = Math.round(ageMs / 1000);
  if (s < 5) {
    return { label: 'just now', stale, neverRan: false };
  }
  if (s < 60) {
    return { label: `${s}s ago`, stale, neverRan: false };
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return { label: `${m}m ago`, stale, neverRan: false };
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return { label: `${h}h ago`, stale, neverRan: false };
  }
  return { label: `${Math.round(h / 24)}d ago`, stale, neverRan: false };
}

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

/**
 * Resolve a chamber role to its roster agenda description, or null if the role
 * is not found or the roster is undefined/empty.
 * This is the crash-safety seam: never indexes or assumes the field exists.
 */
export function rosterAgendaFor(roster: ChamberRosterEntry[] | undefined, role: string): string | null {
  if (!roster || roster.length === 0) return null;
  const entry = roster.find((e) => e.name === role);
  return entry?.agenda ?? null;
}

export const CampaignPanel: React.FC<CampaignPanelProps> = ({ project, onOpenEntity, nowMs }) => {
  const campaigns = useSupervisorStore((s) => s.campaignsByProject[project]) ?? EMPTY;
  const now = nowMs ?? Date.now();

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
        c.droppedAt != null ? (
          // A dropped campaign no longer runs passes or spawns missions — one muted line,
          // no goal/probes/ruling, so retired work cannot be mistaken for live work.
          <div
            key={c.id}
            data-testid="campaign-dropped"
            className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-600"
          >
            <span className="line-through">{c.title}</span>
            <span className="shrink-0 px-1 py-0.5 rounded text-2xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500">
              dropped
            </span>
          </div>
        ) : (
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

          {/* Mission and leaf counts */}
          <span data-testid="campaign-counts" className="px-2 text-3xs text-gray-400 dark:text-gray-500">
            {c.missionCount ?? 0} missions, {c.leafCount ?? 0} leaves
          </span>

          {/* Goal line with null placeholder */}
          <div className="px-2 text-3xs text-gray-400 dark:text-gray-500">
            {c.goal === null ? 'No goal recorded' : c.goal}
          </div>

          {/* Probe rows */}
          {c.probes.length > 0 && (
            <div className="space-y-0.5 pl-2">
              {c.probes.map((probe) => {
                const age = formatProbeAge(probe.lastEvidenceAt, now);
                return (
                  <div
                    key={probe.id}
                    className="flex items-center gap-2 text-2xs text-gray-600 dark:text-gray-400 font-mono"
                    data-probe-evidence={age.neverRan ? 'never' : undefined}
                  >
                    <span className="shrink-0 px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                      {probe.id.slice(0, 8)}
                    </span>
                    <span className="shrink-0">{probe.kind}</span>
                    <span className="shrink-0 text-gray-500 dark:text-gray-500">
                      {probe.environment}
                    </span>
                    <span className="shrink-0">{probe.verdict}</span>
                    <span
                      data-testid="probe-age"
                      className={age.stale ? 'text-amber-600 dark:text-amber-500' : ''}
                    >
                      {age.label}
                      {age.stale && (
                        <span
                          data-testid="probe-stale"
                          className="ml-1 font-semibold text-amber-600 dark:text-amber-500"
                        >
                          ⚠
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Ruling verdict — two mutually exclusive branches */}
          {c.ruling === null ? (
            <div
              data-testid="campaign-unruled"
              className="px-2 text-3xs text-gray-500 dark:text-gray-500"
            >
              Unruled — no judgment recorded
            </div>
          ) : (
            <div data-testid="campaign-ruling" className="px-2 space-y-2">
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

          {/* Chamber deliberation transcript */}
          {c.chamber != null && (
            <div data-testid="campaign-chamber" className="px-2 space-y-2">
              <div data-testid="chamber-transcript" className="max-h-96 overflow-y-auto space-y-2">
                {/* Proposals */}
                {c.chamber.proposals.length > 0 && (
                  <div className="space-y-1">
                    <div data-testid="chamber-phase-heading" className="text-3xs text-gray-600 dark:text-gray-400 font-semibold">
                      Propose
                    </div>
                    {c.chamber.proposals.map((entry, idx) => (
                      <div
                        key={`${entry.phase}-${entry.createdAt}-${idx}`}
                        data-testid="chamber-proposal"
                        className="text-3xs text-gray-600 dark:text-gray-400 space-y-0.5 pl-2"
                      >
                        <ChamberRole role={entry.role} agenda={rosterAgendaFor(c.chamberRoster, entry.role)} />
                        <ClampedBody text={entry.content} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Vetoes */}
                {c.chamber.vetoes.length > 0 && (
                  <div className="space-y-1">
                    <div data-testid="chamber-phase-heading" className="text-3xs text-gray-600 dark:text-gray-400 font-semibold">
                      Veto
                    </div>
                    {c.chamber.vetoes.map((entry, idx) => (
                      <div
                        key={`${entry.phase}-${entry.createdAt}-${idx}`}
                        data-testid="chamber-veto"
                        className="text-3xs text-gray-600 dark:text-gray-400 space-y-0.5 pl-2"
                      >
                        <ChamberRole role={entry.role} agenda={rosterAgendaFor(c.chamberRoster, entry.role)} />
                        <ClampedBody text={entry.content} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Wargame */}
                {c.chamber.wargame.length > 0 && (
                  <div className="space-y-1">
                    <div data-testid="chamber-phase-heading" className="text-3xs text-gray-600 dark:text-gray-400 font-semibold">
                      Wargame
                    </div>
                    {c.chamber.wargame.map((entry, idx) => (
                      <div
                        key={`${entry.phase}-${entry.createdAt}-${idx}`}
                        data-testid="chamber-wargame"
                        className="text-3xs text-gray-600 dark:text-gray-400 space-y-0.5 pl-2"
                      >
                        <ChamberRole role={entry.role} agenda={rosterAgendaFor(c.chamberRoster, entry.role)} />
                        <ClampedBody text={entry.content} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Decision */}
                <div
                  data-testid="chamber-decision"
                  className="text-3xs text-gray-600 dark:text-gray-400 space-y-0.5"
                >
                  <div data-testid="chamber-phase-heading" className="font-semibold">Decision</div>
                <div className="pl-2 space-y-1">
                  {/* Decision entries with role and agenda */}
                  {c.chamber.decision.length > 0 && (
                    <div className="space-y-1">
                      {c.chamber.decision.map((entry, idx) => (
                        <div key={`${entry.phase}-${entry.createdAt}-${idx}`} className="space-y-0.5">
                          <ChamberRole role={entry.role} agenda={rosterAgendaFor(c.chamberRoster, entry.role)} />
                          <ClampedBody text={entry.content} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-gray-500 dark:text-gray-500">
                    <span className="font-mono">Outcome:</span> {c.chamber.outcome}
                  </div>
                  {c.chamber.chosenCandidate !== null && (
                    <div className="text-gray-500 dark:text-gray-500">
                      <span className="font-mono">Chosen:</span> {c.chamber.chosenCandidate}
                    </div>
                  )}
                  {c.chamber.strongestDissent !== null && (
                    <div className="text-gray-500 dark:text-gray-500">
                      <span className="font-mono">Dissent:</span> {c.chamber.strongestDissent}
                    </div>
                  )}
                  {c.chamber.refiningGuidance !== null ? (
                    <div className="text-gray-500 dark:text-gray-500">
                      <span className="font-mono">Guidance:</span> {c.chamber.refiningGuidance}
                    </div>
                  ) : (
                    <div className="text-gray-400 dark:text-gray-600 pl-2 italic">
                      No guidance recorded
                    </div>
                  )}
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
        )
      ))}
    </div>
  );
};

export default CampaignPanel;
