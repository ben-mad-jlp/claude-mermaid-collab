/**
 * MissionsStrip — surfaces convergence-loop MISSIONS distinctly at the TOP of the
 * Plan board. A [MISSION] node is otherwise invisible (just another work-graph
 * todo on the board); this strip renders one card per mission with its PHASE, the
 * GOAL gauge (acceptance criteria met/total — the real convergence gauge), and a
 * secondary BUILD gauge (this iteration's [EPIC] children done/total). Each gauge
 * row EXPANDS to list its underlying items (criteria / epics).
 *
 * Data comes from GET /api/supervisor/missions via supervisorStore.fetchMissions
 * (fail-open → []). Renders NOTHING when there are zero missions (no empty-state
 * clutter). Refetches on mount + project/session change; polls on the board's
 * cadence. When a `session` is passed the bar is scoped to that session's missions.
 */
import React, { useEffect, useState } from 'react';
import { useSupervisorStore, type MissionSummary, type MissionPhase } from '@/stores/supervisorStore';

export interface MissionsStripProps {
  serverId: string;
  project: string;
  /** Optional: scope the bar to missions owned by / assigned to this session. */
  session?: string;
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

/** The 6-phase convergence loop, in order — used to build the phase tooltip. */
const PHASE_CYCLE: MissionPhase[] = ['dogfood', 'find_gap', 'plan', 'steward', 'land', 'assess'];

function phaseTooltip(phase: MissionPhase): string {
  const cycle = PHASE_CYCLE.map((p) => PHASE_LABEL[p]).join(' → ');
  const current = PHASE_LABEL[phase] ?? phase;
  return `Convergence loop: ${cycle} (repeat).\nCurrent phase: ${current}.`;
}

function stripMissionPrefix(title: string): string {
  return title.replace(/^\[MISSION\]\s*/i, '');
}

function stripEpicPrefix(title: string): string {
  return title.replace(/^\[EPIC\]\s*/i, '');
}

/** Board-ish status → dot colour for an epic row. */
function epicDotClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'accepted') return 'bg-success-500';
  if (s === 'blocked' || s === 'rejected' || s === 'failed') return 'bg-warning-500';
  if (s === 'in_progress' || s === 'building' || s === 'active') return 'bg-info-500';
  return 'bg-gray-300 dark:bg-gray-600';
}

/** Expandable labelled progress bar (met/total). `tone` picks the fill family.
 *  Clicking the header row toggles `children` (the underlying item list). */
const Gauge: React.FC<{
  label: string;
  met: number;
  total: number;
  tone: 'goal' | 'build';
  secondary?: boolean;
  headerTitle?: string;
  countTitle?: string;
  open: boolean;
  onToggle: () => void;
  testid?: string;
  children: React.ReactNode;
}> = ({ label, met, total, tone, secondary, headerTitle, countTitle, open, onToggle, testid, children }) => {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  const fill = tone === 'goal' ? 'bg-success-500' : 'bg-info-500';
  const barH = secondary ? 'h-1' : 'h-1.5';
  return (
    <div className={secondary ? 'min-w-[5rem]' : 'min-w-[6rem]'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={testid}
        className="group w-full text-left"
        title={headerTitle}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className={`flex items-center gap-0.5 text-3xs uppercase tracking-wide ${secondary ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>
            <span className="inline-block w-2 text-gray-400 dark:text-gray-500">{open ? '▾' : '▸'}</span>
            {label}
          </span>
          <span
            className={`text-2xs font-mono tabular-nums ${secondary ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}
            title={countTitle}
          >
            {met}/{total}
          </span>
        </div>
        <div className={`mt-0.5 ${barH} w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800`}>
          <div className={`${barH} ${fill} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </button>
      {open && (
        <div className="mt-1 pl-2.5 flex flex-col gap-0.5">
          {children}
        </div>
      )}
    </div>
  );
};

const MissionCard: React.FC<{ m: MissionSummary }> = ({ m }) => {
  const [goalOpen, setGoalOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);

  const phase = (m.rollup?.phase ?? m.mission?.phase ?? 'dogfood') as MissionPhase;
  const iteration = m.rollup?.iteration ?? m.mission?.iteration ?? 0;
  const converged = !!m.rollup?.converged;
  const cap = m.rollup?.capability ?? { met: 0, total: 0 };
  const mech = m.rollup?.mechanical ?? { done: 0, total: 0 };
  const criteria = m.criteria ?? [];
  const epics = m.epics ?? [];
  const owner = m.ownerSession ?? m.assigneeSession ?? null;

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
          title={phaseTooltip(phase)}
        >
          Phase: {PHASE_LABEL[phase] ?? phase}
        </span>
      </div>

      {owner && (
        <div
          className="flex items-center gap-1 text-3xs text-gray-400 dark:text-gray-500"
          title="The session that owns / drives this mission."
        >
          <span aria-hidden>◷</span>
          <span className="font-mono truncate">session: {owner}</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
        <span
          className="font-mono"
          title={`Iteration ${iteration} — how many times this mission has gone around the loop.`}
        >
          iter {iteration}
        </span>
        {converged && (
          <span
            data-testid="mission-converged"
            className="text-success-600 dark:text-success-400 font-semibold"
            title="All criteria met — goal achieved."
          >
            converged ✓
          </span>
        )}
      </div>

      <Gauge
        label="Goal"
        met={cap.met}
        total={cap.total}
        tone="goal"
        headerTitle="Acceptance criteria met — the real 'is the goal achieved' gauge. Click to see the criteria."
        countTitle="Acceptance criteria met / total."
        open={goalOpen}
        onToggle={() => setGoalOpen((v) => !v)}
        testid="mission-goal-toggle"
      >
        {criteria.length === 0 ? (
          <span className="text-3xs text-gray-400 dark:text-gray-500 italic">none yet</span>
        ) : (
          criteria
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((c) => (
              <div key={c.id} className="flex items-start gap-1 text-3xs leading-snug">
                <span className={c.met ? 'text-success-600 dark:text-success-400' : 'text-gray-400 dark:text-gray-500'}>
                  {c.met ? '✓' : '○'}
                </span>
                <span className={c.met ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'}>
                  {c.text}
                </span>
              </div>
            ))
        )}
      </Gauge>

      <Gauge
        label="Build"
        met={mech.done}
        total={mech.total}
        tone="build"
        secondary
        headerTitle="This iteration's epics done / total (the current build work). Click to see the epics."
        countTitle="Epics done / total this iteration."
        open={buildOpen}
        onToggle={() => setBuildOpen((v) => !v)}
        testid="mission-build-toggle"
      >
        {epics.length === 0 ? (
          <span className="text-3xs text-gray-400 dark:text-gray-500 italic">none yet</span>
        ) : (
          epics.map((e) => (
            <div key={e.id} className="flex items-start gap-1 text-3xs leading-snug" title={`${e.status}${e.acceptanceStatus ? ` · ${e.acceptanceStatus}` : ''}`}>
              <span className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${epicDotClass(e.status)}`} aria-hidden />
              <span className="text-gray-600 dark:text-gray-300 truncate">
                {stripEpicPrefix(e.title)}
              </span>
              <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 lowercase">
                {e.status}
              </span>
            </div>
          ))
        )}
      </Gauge>
    </div>
  );
};

export const MissionsStrip: React.FC<MissionsStripProps> = ({ serverId, project, session }) => {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const [missions, setMissions] = useState<MissionSummary[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await fetchMissions(serverId, project, session);
      if (alive) setMissions(next);
    };
    void load();
    // Poll on a modest cadence so phase/gauges track the loop without a WS event.
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serverId, project, session, fetchMissions]);

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
      <div className="flex gap-2 overflow-x-auto px-3 py-2 items-start">
        {missions.map((m) => (
          <MissionCard key={m.node?.id ?? m.mission?.todoId} m={m} />
        ))}
      </div>
    </div>
  );
};

export default MissionsStrip;
