import React from 'react';
import type { SessionSummary } from '@/stores/supervisorStore';
import { wedgeMinutes } from '@/lib/triageSelectors';

export interface WedgeFocusCardProps {
  summary: SessionSummary;
  now: number;
  onOpen: (project: string, session: string) => void;
  onNudge: (project: string, session: string) => void;
  onKill: (project: string, session: string) => void;
  onSnooze: (project: string, session: string) => void;
}

export const WedgeFocusCard: React.FC<WedgeFocusCardProps> = ({
  summary, now, onOpen, onNudge, onKill, onSnooze,
}) => {
  const name = summary.session.split('/').pop() || summary.session;
  const mins = wedgeMinutes(summary, now);
  return (
    <div
      data-testid="wedge-focus-card"
      className="rounded-lg border border-danger-300 dark:border-danger-700 bg-white dark:bg-gray-800 p-4 space-y-3"
    >
      <div className="text-3xs font-semibold tracking-wide text-danger-600 dark:text-danger-400 uppercase">
        ⚠ No progress
      </div>
      <div className="text-sm leading-snug text-gray-800 dark:text-gray-200">
        Session <span className="font-medium">{name}</span> — no progress {mins}m
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={() => onOpen(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-accent-600 text-white hover:bg-accent-700">Open</button>
        <button type="button" onClick={() => onNudge(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Nudge</button>
        <button type="button" onClick={() => onKill(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Kill</button>
        <button type="button" onClick={() => onSnooze(summary.project, summary.session)}
          className="px-3 py-1.5 text-sm font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Snooze</button>
      </div>
    </div>
  );
};

export default WedgeFocusCard;
