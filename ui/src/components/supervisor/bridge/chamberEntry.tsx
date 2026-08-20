/**
 * chamberEntry.tsx — shared chamber transcript entry rendering seam.
 *
 * Extracted from CampaignPanel.tsx so both CampaignPanel and ChamberDecisionIndex can
 * render chamber entries (role, agenda, clamped body, failure line) without an import
 * cycle. Do NOT import CampaignPanel or ChamberDecisionIndex from here — the dependency
 * runs CampaignPanel → ChamberDecisionIndex → chamberEntry, one direction only.
 */

import React, { useState } from 'react';
import type { BridgeChamberEntry, ChamberRosterEntry } from '@/types/campaign';

/**
 * Chamber entry bodies longer than this character count are clamped and can be expanded.
 */
export const CHAMBER_CLAMP_CHARS = 280;

/**
 * Render a chamber role with its optional roster agenda description.
 * The role is rendered in its own <span> to preserve test assertions like
 * screen.getByText('lens-security'). The agenda (if present) renders in a sibling
 * muted element with data-testid="chamber-role-agenda".
 */
export const ChamberRole: React.FC<{ role: string; agenda: string | null }> = ({ role, agenda }) => (
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
 * Resolve a chamber role to its roster agenda description, or null if the role
 * is not found or the roster is undefined/empty.
 * This is the crash-safety seam: never indexes or assumes the field exists.
 */
export function rosterAgendaFor(roster: ChamberRosterEntry[] | undefined, role: string): string | null {
  if (!roster || roster.length === 0) return null;
  const entry = roster.find((e) => e.name === role);
  return entry?.agenda ?? null;
}

/**
 * Parse a chamber entry content string to detect failed general calls.
 * Returns { reason: string | null } when the content is (failed: <reason>) or (failed),
 * or null when the content is ordinary deliberation prose.
 * Returns defensive { reason: null } for any malformed (failed...) string.
 */
export function parseChamberFailure(content: string): { reason: string | null } | null {
  if (!content.startsWith('(failed')) {
    return null;
  }

  if (content === '(failed)') {
    return { reason: null };
  }

  if (content.startsWith('(failed: ') && content.endsWith(')')) {
    const reason = content.slice('(failed: '.length, -1);
    return { reason };
  }

  // Malformed (failed...) string, treat defensively
  return { reason: null };
}

/**
 * Render a failed general call as a single compact line with its recorded reason.
 * Shows the role and the recorded reason, or "no reason recorded" if reason is null.
 */
export const ChamberFailureLine: React.FC<{ role: string; reason: string | null }> = ({ role, reason }) => (
  <div
    data-testid="chamber-failure"
    className="text-gray-500 dark:text-gray-500"
  >
    {role} failed: {reason || 'no reason recorded'}
  </div>
);

/**
 * Route chamber entry rendering between a failure line (if content is a failed call)
 * and the normal role + clamped body pair (for deliberation prose).
 */
export const ChamberEntryBody: React.FC<{ entry: BridgeChamberEntry; agenda: string | null }> = ({
  entry,
  agenda,
}) => {
  const failureInfo = parseChamberFailure(entry.content);

  if (failureInfo !== null) {
    return <ChamberFailureLine role={entry.role} reason={failureInfo.reason} />;
  }

  return (
    <>
      <ChamberRole role={entry.role} agenda={agenda} />
      <ClampedBody text={entry.content} />
    </>
  );
};
