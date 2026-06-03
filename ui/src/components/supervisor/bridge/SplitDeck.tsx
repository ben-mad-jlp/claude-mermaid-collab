/**
 * SplitDeck — the Bridge's root shell (BR-2, design §2/§8).
 *
 * A CommandBar across the top, then two fixed halves below: the LEFT
 * instrument panel (38%) and the RIGHT graph stage (62%). Below 1024px the two
 * halves collapse into a [Panel | Graph] tabbed toggle so neither gets crushed.
 * This is a pure layout primitive — callers pass the bar and the two halves as
 * nodes; SplitDeck owns only the geometry and the responsive switch.
 */

import React, { useState } from 'react';

export interface SplitDeckProps {
  commandBar: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
}

type MobileTab = 'panel' | 'graph';

export const SplitDeck: React.FC<SplitDeckProps> = ({ commandBar, left, right }) => {
  const [tab, setTab] = useState<MobileTab>('panel');

  return (
    <div data-testid="bridge-split-deck" className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      <div className="shrink-0">{commandBar}</div>

      {/* Mobile toggle — only shown under lg. */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 lg:hidden">
        {(['panel', 'graph'] as MobileTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-testid={`split-tab-${t}`}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tab === t
                ? 'bg-accent-100 dark:bg-accent-900/50 text-accent-700 dark:text-accent-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {t === 'panel' ? 'Panel' : 'Graph'}
          </button>
        ))}
      </div>

      {/* Two fixed halves on lg+, single active tab below. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <section
          data-testid="split-left"
          className={`min-h-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 ${
            tab === 'panel' ? 'flex' : 'hidden'
          } w-full lg:flex lg:w-[38%]`}
        >
          <div className="flex flex-col gap-3 p-3 w-full">{left}</div>
        </section>
        <section
          data-testid="split-right"
          className={`min-h-0 overflow-hidden ${tab === 'graph' ? 'flex' : 'hidden'} w-full lg:flex lg:w-[62%]`}
        >
          {right}
        </section>
      </div>
    </div>
  );
};

export default SplitDeck;
