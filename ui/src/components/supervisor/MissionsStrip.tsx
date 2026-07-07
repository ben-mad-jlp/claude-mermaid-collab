/**
 * MissionsStrip — surfaces convergence-loop MISSIONS distinctly at the TOP of the
 * Plan board. A [MISSION] node is otherwise invisible (just another work-graph
 * todo on the board); this strip renders one card per mission with its PHASE, the
 * CAPABILITY gauge (acceptance criteria met/total — the real convergence gauge),
 * and a secondary MECHANICAL gauge (this iteration's [EPIC] children done/total).
 *
 * Data comes from GET /api/supervisor/missions via supervisorStore.fetchMissions
 * (fail-open → []). Renders NOTHING when there are zero missions (no empty-state
 * clutter). Refetches on mount + project change; polls on the board's cadence.
 */
import React, { useEffect, useState } from 'react';
import { useSupervisorStore, type MissionSummary, type MissionPhase } from '@/stores/supervisorStore';

export interface MissionsStripProps {
  serverId: string;
  project: string;
}

/** Phase → pill classes. 'converged' is loud green; the rest reuse the board's
 *  neutral/info/violet/amber token families so the strip reads as one system. */
const PHASE_STYLE: Record<MissionPhase, string> = {
  dogfood:   'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  find_gap:  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  plan:      'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  steward:   'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  land:      'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  assess:    'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  converged: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
};

const PHASE_LABEL: Record<MissionPhase, string> = {
  dogfood: 'Dogfood',
  find_gap: 'Find gap',
  plan: 'Plan',
  steward: 'Steward',
  land: 'Land',
  assess: 'Assess',
  converged: 'Converged',
};

function stripMissionPrefix(title: string): string {
  return title.replace(/^\[MISSION\]\s*/i, '');
}

/** Small labelled progress bar (met/total). `tone` picks the fill family. */
const Gauge: React.FC<{
  label: string;
  met: number;
  total: number;
  tone: 'capability' | 'mechanical';
  secondary?: boolean;
}> = ({ label, met, total, tone, secondary }) => {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  const fill = tone === 'capability' ? 'bg-success-500' : 'bg-info-500';
  const barH = secondary ? 'h-1' : 'h-1.5';
  return (
    <div className={secondary ? 'min-w-[5rem]' : 'min-w-[6rem]'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-3xs uppercase tracking-wide ${secondary ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>
          {label}
        </span>
        <span className={`text-2xs font-mono tabular-nums ${secondary ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
          {met}/{total}
        </span>
      </div>
      <div className={`mt-0.5 ${barH} w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800`}>
        <div className={`${barH} ${fill} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const MissionCard: React.FC<{ m: MissionSummary }> = ({ m }) => {
  const phase = (m.rollup?.phase ?? m.mission?.phase ?? 'dogfood') as MissionPhase;
  const iteration = m.rollup?.iteration ?? m.mission?.iteration ?? 0;
  const converged = !!m.rollup?.converged;
  const cap = m.rollup?.capability ?? { met: 0, total: 0 };
  const mech = m.rollup?.mechanical ?? { done: 0, total: 0 };
  return (
    <div
      data-testid="mission-card"
      className="shrink-0 w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-xs font-semibold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2"
          title={m.node?.title}
        >
          {stripMissionPrefix(m.node?.title ?? 'Mission')}
        </span>
        <span
          className={`shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${PHASE_STYLE[phase] ?? PHASE_STYLE.dogfood}`}
        >
          {PHASE_LABEL[phase] ?? phase}
        </span>
      </div>

      <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
        <span className="font-mono">iter {iteration}</span>
        {converged && (
          <span
            data-testid="mission-converged"
            className="text-success-600 dark:text-success-400 font-semibold"
          >
            converged ✓
          </span>
        )}
      </div>

      <Gauge label="Capability" met={cap.met} total={cap.total} tone="capability" />
      <Gauge label="Mechanical" met={mech.done} total={mech.total} tone="mechanical" secondary />
    </div>
  );
};

export const MissionsStrip: React.FC<MissionsStripProps> = ({ serverId, project }) => {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const [missions, setMissions] = useState<MissionSummary[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await fetchMissions(serverId, project);
      if (alive) setMissions(next);
    };
    void load();
    // Poll on a modest cadence so phase/gauges track the loop without a WS event.
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serverId, project, fetchMissions]);

  if (missions.length === 0) return null;

  return (
    <div
      data-testid="missions-strip"
      className="shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
    >
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Missions
        </span>
        <span className="text-3xs text-gray-400 dark:text-gray-500">
          convergence loop
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {missions.map((m) => (
          <MissionCard key={m.node?.id ?? m.mission?.todoId} m={m} />
        ))}
      </div>
    </div>
  );
};

export default MissionsStrip;
