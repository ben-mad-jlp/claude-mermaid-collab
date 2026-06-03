/**
 * DaemonVitals — Coordinator daemon health (Control-UI vision §4, KPI #4).
 *
 * ● running in success-tone; flips to a loud danger banner
 * `⛔ STOPPED · N ready waiting` when stopped with ready work queued — the
 * silent killer promoted to a banner. Inline Start/Stop is the only
 * Coordinator affordance in the Bridge.
 */

import React from 'react';

export interface DaemonVitalsProps {
  running: boolean;
  readyCount: number;
  onToggle: () => void;
}

export const DaemonVitals: React.FC<DaemonVitalsProps> = ({ running, readyCount, onToggle }) => {
  const stoppedWithWork = !running && readyCount > 0;

  return (
    <div
      data-testid="daemon-vitals"
      className={`flex items-center gap-2 px-2 py-1.5 rounded ${
        stoppedWithWork
          ? 'bg-danger-500 text-white'
          : running
            ? 'bg-success-100 dark:bg-success-900/40 text-success-700 dark:text-success-300'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
      }`}
    >
      <span className="text-2xs font-semibold uppercase tracking-wide opacity-70">Coordinator</span>
      <span className="text-xs font-medium">
        {stoppedWithWork ? (
          <>⛔ STOPPED · {readyCount} ready waiting</>
        ) : running ? (
          <>● running</>
        ) : (
          <>○ stopped</>
        )}
      </span>
      <button
        type="button"
        onClick={onToggle}
        data-testid="daemon-toggle"
        className={`ml-auto px-2 py-0.5 text-2xs font-medium rounded border transition-colors ${
          stoppedWithWork
            ? 'border-white/60 text-white hover:bg-white/20'
            : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        {running ? 'Stop' : 'Start'}
      </button>
    </div>
  );
};
