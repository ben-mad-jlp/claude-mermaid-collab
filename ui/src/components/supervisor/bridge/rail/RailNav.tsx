import React from 'react';

export type RailKey =
  | 'plan'                                            // HOME
  | 'escalations' | 'land'          // ACT
  | 'work' | 'stranded'             // WORK
  | 'stream' | 'executor' | 'subscribers' | 'dogfood'; // TELEMETRY

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

const getBadgeText = (item: RailItem): string => {
  if (item.secondaryCount != null) {
    // Work item: show as "inflight·ready"
    return `${item.count ?? 0}·${item.secondaryCount}`;
  }
  return String(item.count ?? 0);
};

export const RailNav: React.FC<RailNavProps> = ({ sections, selected, onSelect }) => {
  return (
    <nav data-testid="bridge-rail-nav">
      {sections.map((section) => (
        <div key={section.id} data-testid={`rail-section-${section.id}`}>
          <div
            data-testid={`rail-section-label-${section.id}`}
            className="px-2 py-2 text-xs font-bold tracking-widest text-gray-600 dark:text-gray-400 uppercase"
          >
            {section.label}
          </div>
          {section.items.map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid={`rail-item-${item.key}`}
              data-active={selected === item.key}
              onClick={() => onSelect(item.key)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-2xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[active=true]:bg-accent-50 dark:data-[active=true]:bg-accent-900/30 data-[active=true]:text-accent-700 dark:data-[active=true]:text-accent-300"
            >
              <span aria-hidden>{item.icon}</span>
              <span>{item.label}</span>
              {hasBadge(item) && (
                <span
                  data-testid={`rail-badge-${item.key}`}
                  className={`ml-auto ${getToneClass(item.tone)}`}
                >
                  {getBadgeText(item)}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
};
