import React from 'react';
import { useUIStore } from '../../stores/uiStore';

/**
 * MigrationBannerV5
 *
 * One-time welcome banner shown after the v6 upgrade to inform users
 * that the persistent terminal has been retired and moved into the
 * on-demand Shell drawer. Dismissal is persisted via the
 * `seenMigrationBannerV5` flag on the UI store.
 *
 * Renders nothing once dismissed.
 */
export const MigrationBannerV5: React.FC = () => {
  const seen = useUIStore((state) => state.seenMigrationBannerV5);
  const dismiss = useUIStore((state) => state.dismissMigrationBannerV5);

  if (seen) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="
        flex items-start gap-2 px-3 py-2
        text-xs
        bg-info-50 dark:bg-info-950/40
        text-info-900 dark:text-info-100
        border-b border-info-200 dark:border-info-900
      "
    >
      <div className="flex-1 leading-snug">
        <span className="font-medium">Welcome to v6</span>
        {' '}&mdash; the terminal has moved. Tap{' '}
        <kbd className="px-1 py-0.5 rounded border border-info-300 dark:border-info-800 bg-white/60 dark:bg-black/30 font-mono text-3xs">
          &#8984;`
        </kbd>
        {' '}or the <span className="font-medium">Shell</span> button in the header to open it.
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss migration banner"
        className="
          shrink-0 -mt-0.5 -mr-1 px-1.5 py-0.5
          rounded
          text-info-700 dark:text-info-200
          hover:bg-info-100 dark:hover:bg-info-900/60
          focus:outline-none focus:ring-2 focus:ring-info-400
        "
      >
        &times;
      </button>
    </div>
  );
};

MigrationBannerV5.displayName = 'MigrationBannerV5';

export default MigrationBannerV5;
