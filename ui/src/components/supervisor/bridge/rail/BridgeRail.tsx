import React, { useState, useMemo } from 'react';
import { RailNav, RailKey, RailSection, RAIL_SECTION_ORDER } from './RailNav';

export interface BridgeRailCounts {
  escalations?: number;
  land?: number;
  inflight?: number;
  ready?: number;
  stranded?: number;
}

export interface BridgeRailProps {
  counts?: BridgeRailCounts;
  /** Controlled selection; omit for uncontrolled. */
  selected?: RailKey | null;
  defaultSelected?: RailKey | null;
  onSelect?: (key: RailKey | null) => void;
  /** Rail header slot — MISSION block. */
  header?: React.ReactNode;
  /** Rail footer slot — PROJECT block. */
  footer?: React.ReactNode;
}

export const BridgeRail: React.FC<BridgeRailProps> = ({
  counts = {},
  selected: controlledSelected,
  defaultSelected,
  onSelect,
  header,
  footer,
}) => {
  const [inner, setInner] = useState<RailKey | null>(defaultSelected ?? null);
  const active = controlledSelected !== undefined ? controlledSelected : inner;
  const [expanded, setExpanded] = useState<boolean>(false);

  const handleSelect = (k: RailKey) => {
    // Toggle behavior: click active item closes it
    const next = active === k ? null : k;
    setInner(next);
    onSelect?.(next);
  };

  const sections = useMemo<RailSection[]>(() => {
    const result: RailSection[] = [];

    // HOME section
    result.push({
      id: 'home',
      label: 'HOME',
      items: [
        {
          key: 'plan',
          label: 'Plan',
          icon: '▤',
          description: 'Plan board — kanban / list / graph (home)',
        },
      ],
    });

    // ACT section
    result.push({
      id: 'act',
      label: 'ACT',
      items: [
        {
          key: 'escalations',
          label: 'Escalations',
          icon: '!',
          tone: 'loud',
          count: counts.escalations,
          description: 'Blocking escalations awaiting a human decision',
        },
        {
          key: 'land',
          label: 'Land',
          icon: '⬇',
          tone: 'info',
          count: counts.land,
          description: 'Epics ready to land on master',
        },
      ],
    });

    // WORK section
    result.push({
      id: 'work',
      label: 'WORK',
      items: [
        {
          key: 'work',
          label: 'Work',
          icon: '▶',
          tone: 'info',
          count: counts.inflight,
          secondaryCount: counts.ready,
          description: 'In-flight and ready leaves',
        },
        {
          key: 'stranded',
          label: 'Stranded',
          icon: '⑂',
          tone: 'warn',
          count: counts.stranded,
          description: 'Leaves stranded on a branch',
        },
      ],
    });

    // TELEMETRY section
    result.push({
      id: 'telemetry',
      label: 'TELEMETRY',
      items: [
        {
          key: 'stream',
          label: 'Stream',
          icon: '≋',
          description: 'Live event stream',
        },
        {
          key: 'executor',
          label: 'Executor',
          icon: '⚙',
          description: 'Leaf-executor run stats',
        },
        {
          key: 'subscribers',
          label: 'Subscribers',
          icon: '◎',
          description: 'Session subscribers',
        },
        {
          key: 'dogfood',
          label: 'Dogfood',
          icon: '♥',
          description: 'Dogfood health signals',
        },
      ],
    });

    return result;
  }, [counts.escalations, counts.land, counts.inflight, counts.ready, counts.stranded]);

  return (
    <aside
      data-testid="bridge-rail"
      className={`${expanded ? 'w-[296px]' : 'w-14'} shrink-0 flex flex-col min-h-0 border-r border-gray-200 dark:border-gray-700`}
    >
      <button
        type="button"
        data-testid="rail-expand-toggle"
        aria-label={expanded ? 'Collapse rail' : 'Expand rail'}
        onClick={() => setExpanded((v) => !v)}
        className="shrink-0 flex items-center justify-center px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 border-b border-gray-200 dark:border-gray-700"
      >
        <span aria-hidden>{expanded ? '«' : '»'}</span>
      </button>
      {header && (
        <div data-testid="bridge-rail-header" className="shrink-0 border-b border-gray-200 dark:border-gray-700">
          {header}
        </div>
      )}
      <div data-testid="bridge-rail-scroll" className="flex-1 min-h-0 overflow-y-auto">
        <RailNav sections={sections} selected={active} onSelect={handleSelect} expanded={expanded} />
      </div>

      {footer && (
        <div
          data-testid="bridge-rail-footer"
          className="shrink-0 border-t border-gray-200 dark:border-gray-700"
        >
          {footer}
        </div>
      )}
    </aside>
  );
};
