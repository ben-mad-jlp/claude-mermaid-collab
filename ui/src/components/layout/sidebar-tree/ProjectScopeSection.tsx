import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTabsStore } from '@/stores/tabsStore';
import { useUIStore } from '@/stores/uiStore';
import type { SessionTodo } from '@/types/sessionTodo';

/**
 * PCS Phase 5 (Wave 3) — the left-column project-scope level from
 * `wireframe-pcs-left-column`:
 *   SYSTEM (global) strip — open-escalation rollup + context watchdog + System Map.
 *   PROJECT selector — drives uiStore.activeProject (independent of currentSession).
 *   PLAN — the active project's work-graph, compact (epics + dep-aware glyphs).
 *
 * Additive: sits at the top of the existing sidebar accordion; the legacy
 * Servers/Supervisor/Subscriptions/Artifacts sections are unchanged below.
 */

const STATUS_GLYPH: Record<string, string> = {
  done: '●',
  in_progress: '◐',
  blocked: '⊘',
  ready: '○',
  todo: '○',
  planned: '◌',
  backlog: '◌',
  dropped: '⌀',
};
const STATUS_COLOR: Record<string, string> = {
  done: 'text-green-600 dark:text-green-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  blocked: 'text-yellow-600 dark:text-yellow-400',
  ready: 'text-indigo-500 dark:text-indigo-400',
  todo: 'text-gray-500 dark:text-gray-400',
  planned: 'text-gray-400 dark:text-gray-500',
  backlog: 'text-gray-400 dark:text-gray-500',
  dropped: 'text-gray-400 dark:text-gray-500 line-through',
};

function basename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

function planRank(t: SessionTodo): number {
  if (t.status === 'in_progress') return 0;
  if (t.status === 'done' || t.status === 'dropped') return 2;
  return 1;
}

export const ProjectScopeSection: React.FC = () => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  const serverScope = activeId ?? 'local';
  const currentSession = useSessionStore((s) => s.currentSession);

  const watchedProjects = useSupervisorStore((s) => s.watchedProjects);
  const escalations = useSupervisorStore((s) => s.escalations);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const supervised = useSupervisorStore((s) => s.supervised);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadProjects = useSupervisorStore((s) => s.loadProjects);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const loadSupervised = useSupervisorStore((s) => s.loadSupervised);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);
  const resolveEscalation = useSupervisorStore((s) => s.resolveEscalation);

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const upsertSessionTodo = useSessionStore((s) => s.upsertSessionTodo);
  const openPreview = useTabsStore((s) => s.openPreview);

  const activeProjectPref = useUIStore((s) => s.activeProject);
  const setActiveProject = useUIStore((s) => s.setActiveProject);
  const setSupervisorViewOpen = useUIStore((s) => s.setSupervisorViewOpen);

  const [planOpen, setPlanOpen] = useState(true);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [escOpen, setEscOpen] = useState(true);

  // The project in scope: explicit selection → current session → first watched.
  const project = activeProjectPref ?? currentSession?.project ?? watchedProjects[0]?.project ?? '';

  // Project list = watched ∪ current session's project (deduped).
  const projectOptions = useMemo(() => {
    const set = new Set(watchedProjects.map((p) => p.project));
    if (currentSession?.project) set.add(currentSession.project);
    if (project) set.add(project);
    return [...set];
  }, [watchedProjects, currentSession?.project, project]);

  useEffect(() => {
    void loadProjects(serverScope);
    void loadEscalations(serverScope, 'open');
    void loadSupervised(serverScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope]);

  useEffect(() => {
    if (serverScope && project) {
      void loadProjectTodos(serverScope, project);
      void loadCoordinator(serverScope, project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope, project]);

  const openEscalations = escalations.filter((e) => e.status === 'open');
  // Piece 2: this-project escalations (scoped list, not just the global count).
  const scopedEscalations = useMemo(
    () => openEscalations.filter((e) => e.project === project),
    [openEscalations, project],
  );

  // Piece 1: sessions/workers scoped to the active project. Union of supervised
  // rows and live subscriptions for this project, deduped by session name.
  const projectSessions = useMemo(() => {
    const map = new Map<string, { session: string; supervised: boolean; status?: string; contextPercent?: number }>();
    for (const s of supervised) {
      if (s.project === project) map.set(s.session, { session: s.session, supervised: true });
    }
    for (const sub of Object.values(subscriptions)) {
      if (sub.project !== project) continue;
      const prev = map.get(sub.session);
      map.set(sub.session, {
        session: sub.session,
        supervised: prev?.supervised ?? false,
        status: sub.status,
        contextPercent: sub.contextPercent,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.session.localeCompare(b.session));
  }, [supervised, subscriptions, project]);

  const coordinatorRunning = !!coordinatorByProject[project];

  // Piece 4: "sync project to session" — does the current session already match
  // the active project? If not, can we switch to a session under that project?
  const sessionMatchesProject = currentSession?.project === project;
  const syncTargetSession = useMemo(
    () => (sessionMatchesProject ? null : sessions.find((s) => s.project === project) ?? null),
    [sessionMatchesProject, sessions, project],
  );

  // Context-watchdog rollup: max context% across this project's subscriptions.
  const maxContext = useMemo(() => {
    let max = 0;
    for (const sub of Object.values(subscriptions)) {
      if (sub.project === project && typeof sub.contextPercent === 'number') {
        max = Math.max(max, sub.contextPercent);
      }
    }
    return max;
  }, [subscriptions, project]);

  const todos = todosByProject[project] ?? [];
  // Compact plan: hide completed/dropped; in_progress pinned; epic children indented.
  const planRows = useMemo(() => {
    const sort = (a: SessionTodo, b: SessionTodo) =>
      planRank(a) - planRank(b) || (a.order ?? 0) - (b.order ?? 0);
    const byId = new Map(todos.map((t) => [t.id, t]));
    const childrenByParent = new Map<string, SessionTodo[]>();
    const top: SessionTodo[] = [];
    for (const t of todos) {
      if (t.parentId && byId.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      } else top.push(t);
    }
    const rows: { todo: SessionTodo; depth: number }[] = [];
    for (const p of [...top].sort(sort)) {
      rows.push({ todo: p, depth: 0 });
      const kids = childrenByParent.get(p.id);
      if (kids) for (const k of [...kids].sort(sort)) rows.push({ todo: k, depth: 1 });
    }
    return rows.filter((r) => r.todo.status !== 'done' && r.todo.status !== 'dropped');
  }, [todos]);

  const openSystemMap = () => {
    useUIStore.getState().setSupervisorRole('supervisor');
    setSupervisorViewOpen(true);
  };

  // Piece 4: clicking a plan row opens the todo in the detail pane. Project
  // todos and session todos share the backend table, but TodoDetailView reads
  // from the session store; seed the row so it renders even before the session
  // todos for this project are loaded.
  const openTodoDetail = (todo: SessionTodo) => {
    upsertSessionTodo(todo);
    openPreview({
      id: `todo-detail:${todo.id}`,
      kind: 'todo-detail',
      artifactId: todo.id,
      name: todo.title || todo.text || 'Todo',
    });
  };

  // Piece 4: point the current session at a session under the active project so
  // the rest of the (session-scoped) app follows the project in scope.
  const syncProjectToSession = () => {
    if (syncTargetSession) setCurrentSession(syncTargetSession);
  };

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* SYSTEM (global) strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100/60 dark:bg-gray-800/40">
        <span className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">SYSTEM</span>
        {openEscalations.length > 0 && (
          <span
            className="text-[11px] px-1.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
            title={`${openEscalations.length} open escalation(s) across all projects — ${scopedEscalations.length} in this project`}
          >
            ⚠ {openEscalations.length}
          </span>
        )}
        <span
          className={`text-[11px] ${maxContext >= 80 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}
          title="Context watchdog: max context% across this project's sessions"
        >
          ◷ {maxContext > 0 ? `${Math.round(maxContext)}%` : 'all clear'}
        </span>
        <button
          type="button"
          onClick={openSystemMap}
          title="Open System Map (Supervisor view)"
          className="ml-auto text-[11px] px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          ⤢ Map
        </button>
      </div>

      {/* PROJECT selector */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-xs text-gray-400 dark:text-gray-500" aria-hidden>◆</span>
        <select
          value={project}
          onChange={(e) => setActiveProject(e.target.value)}
          className="flex-1 min-w-0 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 py-1 outline-none"
          title={project}
        >
          {projectOptions.length === 0 && <option value="">(no project)</option>}
          {projectOptions.map((p) => (
            <option key={p} value={p}>
              {basename(p)}
            </option>
          ))}
        </select>
        {/* Piece 4: sync project to session — switch the current session to one
            under the active project so the session-scoped app follows scope. */}
        {project && !sessionMatchesProject && (
          <button
            type="button"
            onClick={syncProjectToSession}
            disabled={!syncTargetSession}
            title={
              syncTargetSession
                ? `Switch current session to ${syncTargetSession.name} (in ${basename(project)})`
                : `No open session for ${basename(project)} to sync to`
            }
            className="shrink-0 text-[11px] px-1.5 py-1 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ⇄ Sync
          </button>
        )}
      </div>

      {/* PLAN (scoped) */}
      <div className="px-1 pb-1">
        <button
          type="button"
          onClick={() => setPlanOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        >
          <span className="text-gray-400">{planOpen ? '▾' : '▸'}</span>
          Plan
          <span className="text-gray-400 dark:text-gray-500 font-normal">{planRows.length}</span>
        </button>
        {planOpen && (
          <div className="mt-0.5">
            {!project ? (
              <p className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500">No project in scope.</p>
            ) : planRows.length === 0 ? (
              <p className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500">No open plan items.</p>
            ) : (
              planRows.map(({ todo, depth }) => {
                const glyph = STATUS_GLYPH[todo.status] ?? '○';
                const color = STATUS_COLOR[todo.status] ?? 'text-gray-500';
                const depCount = todo.dependsOn?.length ?? 0;
                return (
                  <button
                    key={todo.id}
                    type="button"
                    onClick={() => openTodoDetail(todo)}
                    title={`${todo.title} — open detail`}
                    className="w-full flex items-start gap-1.5 py-0.5 pr-2 rounded text-left hover:bg-gray-100 dark:hover:bg-gray-800/50"
                    style={{ paddingLeft: `${0.75 + depth * 0.85}rem` }}
                  >
                    <span className={`mt-0.5 text-[11px] font-mono select-none ${color}`} title={todo.status}>
                      {glyph}
                    </span>
                    <span className="flex-1 text-[11px] text-gray-700 dark:text-gray-300 leading-tight truncate">
                      {todo.title}
                    </span>
                    {depCount > 0 && (
                      <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 font-mono" title={`${depCount} deps`}>
                        ⊸{depCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* SESSIONS / WORKERS (scoped) — piece 1: sessions for the active project
          plus the Coordinator daemon status row. */}
      <div className="px-1 pb-1 border-t border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setSessionsOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        >
          <span className="text-gray-400">{sessionsOpen ? '▾' : '▸'}</span>
          Sessions
          <span className="text-gray-400 dark:text-gray-500 font-normal">{projectSessions.length}</span>
        </button>
        {sessionsOpen && (
          <div className="mt-0.5">
            {/* Coordinator status row */}
            <div className="flex items-center gap-1.5 px-3 py-1">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${coordinatorRunning ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                title={coordinatorRunning ? 'Coordinator daemon running' : 'Coordinator daemon stopped'}
              />
              <span className="flex-1 text-[11px] text-gray-600 dark:text-gray-400">
                Coordinator <span className="text-gray-400 dark:text-gray-500">· {coordinatorRunning ? 'running' : 'stopped'}</span>
              </span>
              {project && (
                <button
                  type="button"
                  onClick={() => void setCoordinator(serverScope, project, coordinatorRunning ? 'stop' : 'start')}
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title={coordinatorRunning ? 'Stop the Coordinator daemon' : 'Start the Coordinator daemon'}
                >
                  {coordinatorRunning ? 'Stop' : 'Start'}
                </button>
              )}
            </div>
            {!project ? (
              <p className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500">No project in scope.</p>
            ) : projectSessions.length === 0 ? (
              <p className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500">No sessions for this project.</p>
            ) : (
              projectSessions.map((s) => {
                const isCurrent = sessionMatchesProject && currentSession?.name === s.session;
                const target = sessions.find((x) => x.project === project && x.name === s.session) ?? null;
                return (
                  <button
                    key={s.session}
                    type="button"
                    onClick={() => { if (target) setCurrentSession(target); }}
                    disabled={!target}
                    title={s.session}
                    className={`w-full flex items-center gap-1.5 py-0.5 pl-3 pr-2 rounded text-left hover:bg-gray-100 dark:hover:bg-gray-800/50 disabled:cursor-default ${isCurrent ? 'bg-accent-50 dark:bg-accent-900/30' : ''}`}
                  >
                    {s.supervised && (
                      <span className="shrink-0 text-[10px]" title="Supervised">🔒</span>
                    )}
                    <span className="flex-1 text-[11px] text-gray-700 dark:text-gray-300 leading-tight truncate">
                      {s.session}
                    </span>
                    {typeof s.contextPercent === 'number' && (
                      <span
                        className={`shrink-0 text-[10px] font-mono ${s.contextPercent >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}
                        title="Context %"
                      >
                        {Math.round(s.contextPercent)}%
                      </span>
                    )}
                    {s.status && s.status !== 'unknown' && (
                      <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500" title={`status: ${s.status}`}>
                        {s.status === 'active' || s.status === 'running' ? '●' : '○'}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ESCALATIONS (scoped list) — piece 2: open escalations for the active
          project, with resolve. The SYSTEM strip still shows the global count. */}
      {scopedEscalations.length > 0 && (
        <div className="px-1 pb-1 border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setEscOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-yellow-700 dark:text-yellow-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            <span className="text-gray-400">{escOpen ? '▾' : '▸'}</span>
            Escalations
            <span className="text-gray-400 dark:text-gray-500 font-normal">{scopedEscalations.length}</span>
          </button>
          {escOpen && (
            <div className="mt-0.5 space-y-1 px-2">
              {scopedEscalations.map((e) => (
                <div
                  key={e.id}
                  className="px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 space-y-1"
                >
                  <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate" title={`${e.project} / ${e.session}`}>
                    {e.session}
                  </div>
                  <div className="text-[11px] leading-snug text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                    {e.questionText}
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const target = sessions.find((x) => x.project === e.project && x.name === e.session);
                        if (target) setCurrentSession(target);
                      }}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Jump to session"
                    >
                      Jump
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolveEscalation(serverScope, e.id, 'resolved')}
                      className="px-1.5 py-0.5 text-[10px] rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      title="Mark resolved"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectScopeSection;
