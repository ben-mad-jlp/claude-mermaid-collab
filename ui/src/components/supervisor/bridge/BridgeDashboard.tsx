/**
 * BridgeDashboard — the fleet command center (Control-UI vision §4).
 *
 * Replaces the temporary SupervisorView in Bridge mode. A fixed KPI header in
 * priority order — Escalation Inbox (largest), Worker Pool, Progress Funnel,
 * Daemon Vitals — guarantees the <5s glance. Scoped by the activeProject
 * selector, which now lives ONLY here. Roles collapse into inline actions; no
 * tri-view role swap.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useUIStore } from '@/stores/uiStore';
import { useEventStreamStore } from '@/stores/eventStreamStore';
import { AlertRibbon, type AlertItem } from './AlertRibbon';
import { BridgeEscalationInbox } from './BridgeEscalationInbox';
import { WorkerPool } from './WorkerPool';
import { ProgressFunnel } from './ProgressFunnel';
import { DaemonVitals } from './DaemonVitals';
import { EventStream } from '@/components/stream/EventStream';
import { DrillDock, type DrillTarget } from '@/components/stream/DrillDock';
import type { StreamEvent } from '@/lib/eventTaxonomy';
import { useDiveIn } from '@/hooks/useDiveIn';

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export const BridgeDashboard: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const serverScope = currentSession?.serverId ?? 'local';
  const diveIn = useDiveIn();

  const activeProjectPref = useUIStore((s) => s.activeProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);

  const escalations = useSupervisorStore((s) => s.escalations);
  const supervised = useSupervisorStore((s) => s.supervised);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);
  const loadAudit = useSupervisorStore((s) => s.loadAudit);
  const auditByProject = useSupervisorStore((s) => s.auditByProject);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  // The shared ring buffer drives both the Studio ticker and this stream tile.
  const streamEvents = useEventStreamStore((s) => s.events);
  const backfillFromAudit = useEventStreamStore((s) => s.backfillFromAudit);

  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const project = activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? '';

  // The project options the selector offers: everything we know about.
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    if (currentSession?.project) set.add(currentSession.project);
    supervised.forEach((s) => s.project && set.add(s.project));
    Object.values(subscriptions).forEach((s) => s.project && set.add(s.project));
    Object.keys(todosByProject).forEach((p) => p && set.add(p));
    if (project) set.add(project);
    return Array.from(set);
  }, [currentSession?.project, supervised, subscriptions, todosByProject, project]);

  useEffect(() => {
    void loadEscalations(serverScope, 'open');
    if (project) {
      void loadProjectTodos(serverScope, project);
      void loadCoordinator(serverScope, project);
      void loadAudit(serverScope, project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope, project]);

  // Backfill the ring buffer from audit history whenever it (re)loads for the
  // active project. Merge is idempotent, so re-running on every change is safe.
  const projectAudit = auditByProject[project];
  useEffect(() => {
    if (projectAudit && projectAudit.length > 0) backfillFromAudit(projectAudit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectAudit]);

  const todos = todosByProject[project] ?? [];
  const projectEscalations = useMemo(
    () => escalations.filter((e) => e.project === project),
    [escalations, project],
  );
  const projectSubs = useMemo(
    () => Object.values(subscriptions).filter((s) => s.project === project),
    [subscriptions, project],
  );

  const running = !!coordinatorByProject[project];
  const readyCount = useMemo(
    () => todos.filter((t) => t.status === 'ready' && !t.claimedBy).length,
    [todos],
  );
  const blockedCount = useMemo(() => todos.filter((t) => t.status === 'blocked').length, [todos]);
  const openEscalationCount = projectEscalations.filter((e) => e.status === 'open').length;

  const alerts = useMemo<AlertItem[]>(() => {
    const out: AlertItem[] = [];
    if (openEscalationCount > 0) {
      out.push({ id: 'esc', tone: 'danger', text: `⚠ ${openEscalationCount} open escalation(s)` });
    }
    if (!running && readyCount > 0) {
      out.push({ id: 'daemon', tone: 'danger', text: `⛔ Coordinator STOPPED · ${readyCount} ready waiting` });
    }
    if (blockedCount > 0) {
      out.push({ id: 'blocked', tone: 'warning', text: `⊘ ${blockedCount} blocked todo(s)` });
    }
    return out;
  }, [openEscalationCount, running, readyCount, blockedCount]);

  const projectStreamEvents = useMemo(
    () => streamEvents.filter((e) => !e.project || e.project === project),
    [streamEvents, project],
  );

  // Route a clicked stream row to the matching DrillDock panel.
  const handleStreamSelect = (e: StreamEvent) => {
    if (e.escalationId || e.type === 'escalation.opened') {
      setDrill({ kind: 'escalation' });
    } else if (e.todoId) {
      setDrill({ kind: 'todo', todoId: e.todoId });
    } else if (e.session) {
      setDrill({ kind: 'worker', session: e.session });
    }
  };

  // Dive: select the session, flip to Studio, fire activation side-effects, and
  // let the shared-element layoutId morph the card into the cockpit frame.
  const handleJump = (proj: string, session: string) => {
    diveIn({ project: proj, session });
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
        No project in scope. Open a session or pick a project.
      </div>
    );
  }

  return (
    <div data-testid="bridge-dashboard" className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* Identity + project selector (the only place the selector now lives). */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-base" role="img" aria-label="bridge">⤢</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bridge</span>
        <select
          data-testid="bridge-project-select"
          value={project}
          onChange={(e) => setActiveProject(e.target.value)}
          className="ml-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 outline-none max-w-[240px]"
        >
          {projectOptions.map((p) => (
            <option key={p} value={p}>
              {projectBasename(p)}
            </option>
          ))}
        </select>
      </div>

      <AlertRibbon alerts={alerts} />

      {/* Body: KPI grid (+ stream tile) on the left, DrillDock on the right. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 overflow-auto min-h-0 p-3 grid grid-cols-1 lg:grid-cols-3 gap-3 auto-rows-min">
          <div className="lg:col-span-2 lg:row-span-2">
            <BridgeEscalationInbox
              escalations={projectEscalations}
              serverScope={serverScope}
              onJump={handleJump}
            />
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <DaemonVitals
              running={running}
              readyCount={readyCount}
              onToggle={() => void setCoordinator(serverScope, project, running ? 'stop' : 'start')}
            />
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <ProgressFunnel todos={todos} onDrill={(segment) => setDrill({ kind: 'funnel', segment })} />
          </div>
          <div className="lg:col-span-3 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <WorkerPool
              subscriptions={projectSubs}
              todos={todos}
              onJump={handleJump}
              onSelect={(session) => setDrill({ kind: 'worker', session })}
            />
          </div>
          {/* Live fleet stream tile. */}
          <div className="lg:col-span-3 rounded-lg border border-gray-200 dark:border-gray-700 p-2 flex flex-col min-h-[12rem] max-h-80">
            <div className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              Stream
            </div>
            <EventStream
              events={projectStreamEvents}
              onSelectEvent={handleStreamSelect}
              className="flex-1 min-h-0"
            />
          </div>
        </div>

        {drill && (
          <DrillDock
            target={drill}
            serverScope={serverScope}
            project={project}
            subscriptions={projectSubs}
            todos={todos}
            onJump={handleJump}
            onClose={() => setDrill(null)}
          />
        )}
      </div>
    </div>
  );
};

export default BridgeDashboard;
