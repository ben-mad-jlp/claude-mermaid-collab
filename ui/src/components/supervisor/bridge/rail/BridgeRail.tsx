import React, { useState, useMemo } from 'react';
import { RailNav, RailKey, RailSection, RAIL_SECTION_ORDER } from './RailNav';
import { CampaignIcon, MissionIcon } from './navIcons';

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
  /** Callback to open the campaigns view. */
  onOpenCampaigns?: () => void;
  /** Callback to open the missions view. */
  onOpenMissions?: () => void;
  /** True while the campaigns stage panel is showing — highlights the Campaigns link. */
  campaignsActive?: boolean;
  /** True while the missions stage panel is showing — highlights the Missions link. */
  missionsActive?: boolean;
}

export const BridgeRail: React.FC<BridgeRailProps> = ({
  counts = {},
  selected: controlledSelected,
  defaultSelected,
  onSelect,
  header,
  footer,
  onOpenCampaigns,
  onOpenMissions,
  campaignsActive = false,
  missionsActive = false,
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
          countWord: 'running',
          secondaryCountWord: 'queued',
          description: 'In-flight and ready leaves',
        },
        {
          key: 'stranded',
          label: 'Stranded',
          icon: '⑂',
          tone: 'warn',
          count: counts.stranded,
          countWord: 'stranded',
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
          key: 'usage',
          label: 'Usage',
          icon: '◔',
          description: 'Token-usage statistics — per-source LLM burn + account rate limits',
        },
        {
          key: 'dogfood',
          label: 'Dogfood',
          icon: '♥',
          description: 'Dogfood health signals',
        },
        {
          key: 'conductor',
          label: 'Conductor',
          icon: '☉',
          description: 'Conductor pass journal — decisions, criteria acted on, epics served',
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
      <div data-testid="bridge-rail-links" className="shrink-0 flex flex-col border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          data-testid="bridge-link-campaigns"
          aria-label="Campaigns"
          data-active={campaignsActive}
          onClick={() => onOpenCampaigns?.()}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-2xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[active=true]:bg-accent-50 dark:data-[active=true]:bg-accent-900/30 data-[active=true]:text-accent-700 dark:data-[active=true]:text-accent-300 ${expanded ? 'justify-start' : 'justify-center'}`}
        >
          <CampaignIcon />
          {expanded && <span>Campaigns</span>}
        </button>
        <button
          type="button"
          data-testid="bridge-link-missions"
          aria-label="Missions"
          data-active={missionsActive}
          onClick={() => onOpenMissions?.()}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-2xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[active=true]:bg-accent-50 dark:data-[active=true]:bg-accent-900/30 data-[active=true]:text-accent-700 dark:data-[active=true]:text-accent-300 ${expanded ? 'justify-start' : 'justify-center'}`}
        >
          <MissionIcon />

          {expanded && <span>Missions</span>}
        </button>
      </div>
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
