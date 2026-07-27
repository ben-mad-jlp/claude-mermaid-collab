import React from 'react';

export type RailKey =
  | 'missions' | 'plan'                               // HOME
  | 'escalations' | 'land'          // ACT
  | 'work' | 'stranded'             // WORK
  | 'stream' | 'executor' | 'subscribers' | 'usage' | 'dogfood'; // TELEMETRY

export type RailTone = 'loud' | 'warn' | 'info';

export interface RailItem {
  key: RailKey;
  label: string;
  icon: string;
  tone?: RailTone;
  /** Rendered only when > 0. */
  count?: number;
  /** Work only: second number of the `inflight·ready` badge. Rendered when EITHER number > 0. */
  secondaryCount?: number;
  /** Expanded-rail word label for `count` (e.g. "running", "stranded"). Ignored when collapsed. */
  countWord?: string;
  /** Expanded-rail word label for `secondaryCount` (e.g. "queued"). Ignored when collapsed. */
  secondaryCountWord?: string;
  /** One-line hover description; surfaced via the button `title` tooltip. */
  description: string;
}

export interface RailSection {
  id: 'home' | 'act' | 'work' | 'telemetry';
  label: string;
  items: RailItem[];
}

export interface RailNavProps {
  sections: RailSection[];
  selected: RailKey | null;
  onSelect: (key: RailKey) => void;
  expanded: boolean;
}

export const RAIL_SECTION_ORDER: ReadonlyArray<RailSection['id']> = ['home', 'act', 'work', 'telemetry'];

const hasBadge = (i: RailItem) => (i.count ?? 0) > 0 || (i.secondaryCount ?? 0) > 0;

const getToneClass = (tone?: RailTone) => {
  if (tone === 'loud') {
    return 'text-danger-600 dark:text-danger-400 font-bold';
  }
  if (tone === 'warn') {
    return 'text-warning-600 dark:text-warning-400 font-semibold';
  }
  if (tone === 'info') {
    return 'text-info-700 dark:text-info-400 font-semibold';
  }
  return 'text-gray-400 dark:text-gray-500';
};

const getBadgeText = (item: RailItem, expanded: boolean): string => {
  if (item.secondaryCount != null) {
    if (expanded && item.countWord && item.secondaryCountWord) {
      return `${item.count ?? 0} ${item.countWord} · ${item.secondaryCount} ${item.secondaryCountWord}`;
    }
    return `${item.count ?? 0}·${item.secondaryCount}`;
  }
  if (expanded && item.countWord) {
    return `${item.count ?? 0} ${item.countWord}`;
  }
  return String(item.count ?? 0);
};

export const RailNav: React.FC<RailNavProps> = ({ sections, selected, onSelect, expanded }) => {
  return (
    <nav data-testid="bridge-rail-nav">
      {sections.map((section, index) => (
        <div key={section.id} data-testid={`rail-section-${section.id}`}>
          {index > 0 && (
            <div
              data-testid={`rail-divider-${section.id}`}
              className="mx-2 my-1 border-t border-gray-200 dark:border-gray-700"
            />
          )}
          {expanded && (
            <div
              data-testid={`rail-section-label-${section.id}`}
              className="px-2 py-2 text-xs font-bold tracking-widest text-gray-600 dark:text-gray-400 uppercase"
            >
              {section.label}
            </div>
          )}
          {section.items.map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid={`rail-item-${item.key}`}
              data-active={selected === item.key}
              onClick={() => onSelect(item.key)}
              title={`${item.label} — ${item.description}`}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-2xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[active=true]:bg-accent-50 dark:data-[active=true]:bg-accent-900/30 data-[active=true]:text-accent-700 dark:data-[active=true]:text-accent-300 ${expanded ? 'justify-start' : 'justify-center'}`}
            >
              <span aria-hidden>{item.icon}</span>
              {expanded && <span>{item.label}</span>}
              {hasBadge(item) && (
                <span
                  data-testid={`rail-badge-${item.key}`}
                  className={`${expanded ? 'ml-auto ' : ''}${getToneClass(item.tone)}`}
                >
                  {getBadgeText(item, expanded)}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
};
