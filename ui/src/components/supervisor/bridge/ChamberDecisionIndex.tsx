import React, { useState } from 'react';
import type { BridgeChamberDeliberation, BridgeChamberEntry } from '../../../types/campaign';

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

function ChamberPhaseBucket({ heading, entries }: { heading: string; entries: BridgeChamberEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div data-testid="chamber-phase-heading" className="text-3xs text-gray-600 dark:text-gray-400 font-semibold">
        {heading}
      </div>
      {entries.map((entry, idx) => (
        <div
          key={`${entry.phase}-${entry.createdAt}-${idx}`}
          className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5 pl-2"
        >
          <div className="text-3xs text-gray-500 dark:text-gray-500 font-semibold">{entry.role}</div>
          <div>{entry.content}</div>
        </div>
      ))}
    </div>
  );
}

/** Prop-driven index of chamber decisions: a selectable list that drills into the full
 *  transcript for the clicked decision. No store read, no fetch, no polling — the `decisions`
 *  prop and the selected index are the only data sources. */
export const ChamberDecisionIndex: React.FC<{ decisions: BridgeChamberDeliberation[] }> = ({ decisions }) => {
  const [selected, setSelected] = useState<number | null>(null);

  if (decisions.length === 0) {
    return <div className="text-3xs text-gray-500 dark:text-gray-500">No deliberations recorded</div>;
  }

  if (selected !== null) {
    const d = decisions[selected];
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setSelected(null)}>
          Back to decisions
        </button>
        <ChamberPhaseBucket heading="Proposals" entries={d.proposals} />
        <ChamberPhaseBucket heading="Vetoes" entries={d.vetoes} />
        <ChamberPhaseBucket heading="Wargame" entries={d.wargame} />
        <ChamberPhaseBucket heading="Decision" entries={d.decision} />
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
