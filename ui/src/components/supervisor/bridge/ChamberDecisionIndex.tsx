import React, { useState } from 'react';
import type { BridgeChamberDeliberation, BridgeChamberEntry, ChamberRosterEntry } from '../../../types/campaign';
import { ChamberEntryBody, rosterAgendaFor } from './chamberEntry';

/** Locale-independent YYYY-MM-DD HH:mm formatter, built from Date getters and padStart so it
 *  doesn't vary by CI locale/TZ. */
export function formatDecidedAt(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function summaryFor(d: BridgeChamberDeliberation): string {
  return d.chosenCandidate ?? d.strongestDissent ?? d.refiningGuidance ?? 'No summary recorded';
}

/** A propose/veto/wargame bucket of chamber entries, headed by its phase heading and
 *  rendering each entry via the shared ChamberEntryBody. */
function ChamberPhaseBucket({
  heading,
  testId,
  entries,
  roster,
}: {
  heading: string;
  testId: string;
  entries: BridgeChamberEntry[];
  roster: ChamberRosterEntry[] | undefined;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div data-testid="chamber-phase-heading" className="text-3xs text-gray-600 dark:text-gray-400 font-semibold">
        {heading}
      </div>
      {entries.map((entry, idx) => (
        <div
          key={`${entry.phase}-${entry.createdAt}-${idx}`}
          data-testid={testId}
          className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5 pl-2"
        >
          <ChamberEntryBody entry={entry} agenda={rosterAgendaFor(roster, entry.role)} />
        </div>
      ))}
    </div>
  );
}

/** The Decision bucket: phase heading, decision entries, and the Outcome/Chosen/Dissent/
 *  Guidance summary lines, falling back to "No guidance recorded" when refiningGuidance
 *  is null. */
function ChamberDecisionBlock({
  d,
  roster,
}: {
  d: BridgeChamberDeliberation;
  roster: ChamberRosterEntry[] | undefined;
}) {
  return (
    <div
      data-testid="chamber-decision"
      className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5"
    >
      <div data-testid="chamber-phase-heading" className="font-semibold">Decision</div>
      <div className="pl-2 space-y-1">
        {d.decision.length > 0 && (
          <div className="space-y-1">
            {d.decision.map((entry, idx) => (
              <div key={`${entry.phase}-${entry.createdAt}-${idx}`} className="space-y-0.5">
                <ChamberEntryBody entry={entry} agenda={rosterAgendaFor(roster, entry.role)} />
              </div>
            ))}
          </div>
        )}
        <div className="text-gray-500 dark:text-gray-500">
          <span className="font-mono">Outcome:</span> {d.outcome}
        </div>
        {d.chosenCandidate !== null && (
          <div className="text-gray-500 dark:text-gray-500">
            <span className="font-mono">Chosen:</span> {d.chosenCandidate}
          </div>
        )}
        {d.strongestDissent !== null && (
          <div className="text-gray-500 dark:text-gray-500">
            <span className="font-mono">Dissent:</span> {d.strongestDissent}
          </div>
        )}
        {d.refiningGuidance !== null ? (
          <div className="text-gray-500 dark:text-gray-500">
            <span className="font-mono">Guidance:</span> {d.refiningGuidance}
          </div>
        ) : (
          <div className="text-gray-400 dark:text-gray-600 pl-2 italic">
            No guidance recorded
          </div>
        )}
      </div>
    </div>
  );
}

/** Prop-driven index of chamber decisions: a selectable list that drills into the full
 *  transcript for the clicked decision. No store read, no fetch, no polling — the `decisions`
 *  prop, the optional `roster` prop and the selected index are the only data sources. */
export const ChamberDecisionIndex: React.FC<{
  decisions: BridgeChamberDeliberation[];
  roster?: ChamberRosterEntry[];
}> = ({ decisions, roster }) => {
  const [selected, setSelected] = useState<number | null>(null);

  if (decisions.length === 0) {
    return <div className="text-3xs text-gray-500 dark:text-gray-500">No deliberations recorded</div>;
  }

  if (selected !== null) {
    const d = decisions[selected];
    return (
      <div className="space-y-2 flex-1 min-h-0 flex flex-col">
        <button type="button" onClick={() => setSelected(null)}>
          Back to decisions
        </button>
        <div data-testid="chamber-transcript" className="flex-1 min-h-0 overflow-y-auto space-y-2">
          <ChamberPhaseBucket heading="Propose" testId="chamber-proposal" entries={d.proposals} roster={roster} />
          <ChamberPhaseBucket heading="Veto" testId="chamber-veto" entries={d.vetoes} roster={roster} />
          <ChamberPhaseBucket heading="Wargame" testId="chamber-wargame" entries={d.wargame} roster={roster} />
          <ChamberDecisionBlock d={d} roster={roster} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {decisions.map((d, idx) => {
        const summary = summaryFor(d);
        return (
          <button
            key={d.sessionId}
            type="button"
            data-testid="chamber-decision-row"
            onClick={() => setSelected(idx)}
            className="w-full text-left px-2 py-1 text-3xs text-gray-600 dark:text-gray-400"
          >
            <span>{formatDecidedAt(d.decidedAt)}</span>{' '}
            <span>{d.outcome}</span>{' '}
            <span className="truncate overflow-hidden text-ellipsis whitespace-nowrap" title={summary}>
              {summary}
            </span>
          </button>
        );
      })}
    </div>
  );
};
