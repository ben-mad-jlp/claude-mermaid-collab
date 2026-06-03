/**
 * ContextChip — the current session's context-window gauge (Control-UI §3).
 *
 * A quiet `◷ N%` chip in the Studio left rail. At ≥80% it expands into a
 * full-width `warning` banner — the single context signal Studio surfaces.
 */

import React from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

const WARN_THRESHOLD = 80;

export const ContextChip: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  if (!currentSession) return null;

  // Subscriptions are keyed by `${serverId}:${project}:${session}`; match the
  // current session without assuming the key format beyond a suffix match.
  const sub = Object.values(subscriptions).find(
    (s) => s.project === currentSession.project && s.session === currentSession.name,
  );
  const pct = sub?.contextPercent;

  if (typeof pct !== 'number' || pct <= 0) {
    return (
      <div
        data-testid="context-chip"
        className="text-2xs text-gray-400 dark:text-gray-500"
        title="Context window usage"
      >
        ◷ all clear
      </div>
    );
  }

  const warn = pct >= WARN_THRESHOLD;
  const rounded = Math.round(pct);

  if (warn) {
    return (
      <div
        data-testid="context-chip-banner"
        role="status"
        className="w-full px-2 py-1 rounded text-2xs font-medium bg-warning-100 dark:bg-warning-900/40 text-warning-700 dark:text-warning-300"
        title="Context window is nearly full — consider checkpointing and clearing."
      >
        ◷ {rounded}% context — nearing the limit
      </div>
    );
  }

  return (
    <div
      data-testid="context-chip"
      className="text-2xs text-gray-400 dark:text-gray-500"
      title="Context window usage"
    >
      ◷ {rounded}%
    </div>
  );
};
