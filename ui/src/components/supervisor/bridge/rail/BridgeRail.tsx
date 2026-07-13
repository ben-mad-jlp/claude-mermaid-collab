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
        },
        {
          key: 'land',
          label: 'Land',
          icon: '⬇',
          tone: 'info',
          count: counts.land,
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
        },
        {
          key: 'stranded',
          label: 'Stranded',
          icon: '⑂',
          tone: 'warn',
          count: counts.stranded,
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
        },
        {
          key: 'executor',
          label: 'Executor',
          icon: '⚙',
        },
        {
          key: 'subscribers',
          label: 'Subscribers',
          icon: '◎',
        },
        {
          key: 'dogfood',
          label: 'Dogfood',
          icon: '♥',
        },
      ],
    });

    return result;
  }, [counts.escalations, counts.land, counts.inflight, counts.ready, counts.stranded]);

  return (
    <aside
      data-testid="bridge-rail"
      className="w-[296px] shrink-0 flex flex-col min-h-0 border-r border-gray-200 dark:border-gray-700"
    >
      {header && (
        <div data-testid="bridge-rail-header" className="shrink-0 border-b border-gray-200 dark:border-gray-700">
          {header}
        </div>
      )}
      <RailNav sections={sections} selected={active} onSelect={handleSelect} />

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
