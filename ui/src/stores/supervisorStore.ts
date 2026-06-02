import { create } from 'zustand';
import type { SessionTodo } from '@/types/sessionTodo';

/**
 * Supervisor store (v2 global model).
 *
 * In v2 the supervisor surface is global rather than scoped to a single
 * supervisor session. The app tracks a flat set of watched projects, a roadmap
 * keyed by project, and a flat list of escalations. All of
 * these live authoritatively on the server behind the `/api/supervisor/*` REST
 * surface; this store mirrors them into the renderer.
 *
 * SERVER IS SOURCE OF TRUTH. localStorage is used purely as a cache so the panel
 * paints instantly on app reopen before the corresponding `load*` call re-fetches
 * from the server and overwrites the cache wholesale. Mutations are applied
 * locally only after the server confirms (res.ok); on failure prior state is left
 * untouched.
 *
 * The `serverId` threaded through every action is the active server's id and is
 * used solely for invoke routing — the data model itself is not keyed by server.
 *
 * Persistence is manual (localStorage.setItem on every mutation) rather than via
 * zustand's persist middleware, matching `subscriptionStore.ts`.
 */
export interface WatchedProject {
  project: string;
  addedAt: number;
}

export interface RoadmapItem {
  id: string;
  project: string;
  title: string;
  description?: string | null;
  status: string;
  ord: number;
  parentId?: string | null;
  dependsOn?: string[];
  sessionName?: string | null;
  blueprintId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  kind: string;
  project: string;
  session: string;
  detail: string | null;
  serverId: string;
}

export interface EscalationOption {
  id: string;
  label: string;
  detail?: string;
}

export interface Escalation {
  id: string;
  project: string;
  session: string;
  kind: string;
  questionText: string;
  status: string;
  createdAt: number;
  resolvedAt?: number | null;
  // ED1: structured decision options. Null/absent for a plain question, in which
  // case the UI renders the legacy Jump/Resolve card instead of a decision card.
  options?: EscalationOption[] | null;
  recommended?: string | null; // option id the worker recommends, if any
}

export interface SupervisedSession {
  project: string;
  session: string;
  source?: string;
  addedAt?: number;
  serverId?: string;
}

const PROJECTS_KEY = 'supervisor-projects';
const ROADMAP_KEY = 'supervisor-roadmap';
const TODOS_KEY = 'supervisor-todos-by-project';
const ESCALATIONS_KEY = 'supervisor-escalations';
const SUPERVISED_KEY = 'supervisor-supervised';
const SUPERVISOR_CONFIG_KEY = 'supervisor-config';

export interface SupervisorConfig {
  supervisorProject: string;
  supervisorSession: string;
}

interface InvokeResult {
  ok: boolean;
  status: number;
  body: any;
}

/**
 * Route a REST call to a specific server. In the desktop app the preload bridge
 * (`window.mc.invokeOnServer`) proxies to the correct server process; in a plain
 * browser tab we fall back to a same-origin `fetch`. The DELETE body must ride
 * along in the fetch fallback (it carries the membership identity to remove).
 */
async function invoke(serverId: string, path: string, method: string, body?: any): Promise<InvokeResult | null> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) {
    return mc.invokeOnServer(serverId, { path, method, body }).catch(() => null);
  }
  try {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return null;
  }
}

function hydrate<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface SupervisorState {
  watchedProjects: WatchedProject[];
  roadmapByProject: Record<string, RoadmapItem[]>;
  todosByProject: Record<string, SessionTodo[]>;
  escalations: Escalation[];
  supervised: SupervisedSession[];
  config: SupervisorConfig | null;
  auditByProject: Record<string, AuditEntry[]>;
  loadAudit: (serverId: string, project: string, kind?: string) => Promise<void>;
  loadSupervised: (serverId: string) => Promise<void>;
  setSupervisedLocal: (session: SupervisedSession, supervised: boolean) => void;
  loadProjects: (serverId: string) => Promise<void>;
  addProject: (serverId: string, project: string) => Promise<void>;
  removeProject: (serverId: string, project: string) => Promise<void>;
  loadRoadmap: (serverId: string, project: string) => Promise<void>;
  loadProjectTodos: (serverId: string, project: string) => Promise<void>;
  promoteTodo: (serverId: string, project: string, id: string, status: string) => Promise<void>;
  coordinatorByProject: Record<string, boolean>;
  loadCoordinator: (serverId: string, project: string) => Promise<void>;
  setCoordinator: (serverId: string, project: string, action: 'start' | 'stop') => Promise<void>;
  loadEscalations: (serverId: string, status?: string) => Promise<void>;
  resolveEscalation: (serverId: string, id: string, status: string) => Promise<void>;
  decideEscalation: (serverId: string, id: string, optionId: string) => Promise<boolean>;
  nudge: (serverId: string, project: string, session: string, text: string) => Promise<boolean>;
  loadConfig: (serverId: string) => Promise<void>;
  saveConfig: (serverId: string, supervisorProject: string, supervisorSession: string) => Promise<void>;
}

export const useSupervisorStore = create<SupervisorState>((set, get) => ({
  watchedProjects: hydrate<WatchedProject[]>(PROJECTS_KEY, []),
  roadmapByProject: hydrate<Record<string, RoadmapItem[]>>(ROADMAP_KEY, {}),
  todosByProject: hydrate<Record<string, SessionTodo[]>>(TODOS_KEY, {}),
  coordinatorByProject: {},
  escalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  supervised: hydrate<SupervisedSession[]>(SUPERVISED_KEY, []),
  config: hydrate<SupervisorConfig | null>(SUPERVISOR_CONFIG_KEY, null),
  auditByProject: {},

  loadAudit: async (serverId, project, kind?) => {
    const qs = new URLSearchParams({ project });
    if (kind) qs.set('kind', kind);
    const res = await invoke(serverId, `/api/supervisor/audit?${qs.toString()}`, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => ({ auditByProject: { ...state.auditByProject, [project]: res.body?.entries ?? [] } }));
  },

  loadSupervised: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/supervised', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const supervised: SupervisedSession[] = res.body?.supervised ?? [];
    localStorage.setItem(SUPERVISED_KEY, JSON.stringify(supervised));
    set({ supervised });
  },

  // Optimistically add/remove a supervised session so the Supervisor panel
  // reflects a toggle immediately, instead of waiting for the next poll/reload.
  // The caller still fires the REST mutation + loadSupervised() to reconcile.
  setSupervisedLocal: (session, supervised) => {
    set((state) => {
      const key = `${session.project}:${session.session}`;
      const without = state.supervised.filter((s) => `${s.project}:${s.session}` !== key);
      const next = supervised
        ? [...without, { ...session, addedAt: session.addedAt ?? Date.now() }]
        : without;
      localStorage.setItem(SUPERVISED_KEY, JSON.stringify(next));
      return { supervised: next };
    });
  },

  loadProjects: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/projects', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const watchedProjects: WatchedProject[] = res.body?.projects ?? [];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
    set({ watchedProjects });
  },

  addProject: async (serverId, project) => {
    const res = await invoke(serverId, '/api/supervisor/projects', 'POST', { project });
    if (!res?.ok) return; // leave state unchanged on failure
    set((state) => {
      if (state.watchedProjects.some((w) => w.project === project)) return state;
      const watchedProjects = [...state.watchedProjects, { project, addedAt: Date.now() }];
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
      return { watchedProjects };
    });
  },

  removeProject: async (serverId, project) => {
    const res = await invoke(serverId, '/api/supervisor/projects', 'DELETE', { project });
    if (!res?.ok) return; // leave state unchanged on failure
    set((state) => {
      const watchedProjects = state.watchedProjects.filter((w) => w.project !== project);
      const roadmapByProject = { ...state.roadmapByProject };
      delete roadmapByProject[project];
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(watchedProjects));
      localStorage.setItem(ROADMAP_KEY, JSON.stringify(roadmapByProject));
      return { watchedProjects, roadmapByProject };
    });
  },

  loadRoadmap: async (serverId, project) => {
    const path = `/api/supervisor/roadmap?project=${encodeURIComponent(project)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => {
      const roadmapByProject = { ...state.roadmapByProject, [project]: res.body?.items ?? [] };
      localStorage.setItem(ROADMAP_KEY, JSON.stringify(roadmapByProject));
      return { roadmapByProject };
    });
  },

  loadProjectTodos: async (serverId, project) => {
    const path = `/api/supervisor/todos?project=${encodeURIComponent(project)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    set((state) => {
      const todosByProject = { ...state.todosByProject, [project]: res.body?.todos ?? [] };
      localStorage.setItem(TODOS_KEY, JSON.stringify(todosByProject));
      return { todosByProject };
    });
  },

  promoteTodo: async (serverId, project, id, status) => {
    const res = await invoke(serverId, '/api/supervisor/todos', 'PATCH', { project, id, status });
    if (!res?.ok) return;
    // Re-fetch the project plan so the change is reflected everywhere.
    await get().loadProjectTodos(serverId, project);
  },

  loadCoordinator: async (serverId, project) => {
    const path = `/api/supervisor/coordinator?project=${encodeURIComponent(project)}`;
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return;
    set((state) => ({
      coordinatorByProject: { ...state.coordinatorByProject, [project]: !!res.body?.running },
    }));
  },

  setCoordinator: async (serverId, project, action) => {
    const res = await invoke(serverId, '/api/supervisor/coordinator', 'POST', { project, action });
    if (!res?.ok) return;
    set((state) => ({
      coordinatorByProject: { ...state.coordinatorByProject, [project]: !!res.body?.running },
    }));
  },

  loadEscalations: async (serverId, status?) => {
    const path = status
      ? `/api/supervisor/escalations?status=${encodeURIComponent(status)}`
      : '/api/supervisor/escalations';
    const res = await invoke(serverId, path, 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const escalations: Escalation[] = res.body?.escalations ?? [];
    localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
    set({ escalations });
  },

  nudge: async (serverId, project, session, text) => {
    const res = await invoke(serverId, '/api/supervisor/nudge', 'POST', { project, session, text });
    return !!res?.ok;
  },

  loadConfig: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/config', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const config: SupervisorConfig = {
      supervisorProject: res.body?.supervisorProject,
      supervisorSession: res.body?.supervisorSession,
    };
    localStorage.setItem(SUPERVISOR_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  saveConfig: async (serverId, supervisorProject, supervisorSession) => {
    const res = await invoke(serverId, '/api/supervisor/config', 'POST', { supervisorProject, supervisorSession });
    if (!res?.ok) return; // leave state unchanged on failure
    const config: SupervisorConfig = res.body?.supervisorProject
      ? { supervisorProject: res.body.supervisorProject, supervisorSession: res.body.supervisorSession }
      : { supervisorProject, supervisorSession };
    localStorage.setItem(SUPERVISOR_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  resolveEscalation: async (serverId, id, status) => {
    const res = await invoke(serverId, '/api/supervisor/escalations/resolve', 'POST', { id, status });
    if (!res?.ok) return; // leave state unchanged on failure
    set((state) => {
      const escalations = state.escalations.map((e) =>
        e.id === id ? { ...e, status, resolvedAt: Date.now() } : e,
      );
      localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
      return { escalations };
    });
  },

  // ED2/ED3: answer a structured escalation by choosing one of its options. The
  // server relays the choice to the waiting worker and resolves the escalation
  // (status 'decided'); we mirror that locally so the card drops out of the list.
  decideEscalation: async (serverId, id, optionId) => {
    const res = await invoke(serverId, `/api/supervisor/escalation/${encodeURIComponent(id)}/decide`, 'POST', { optionId });
    if (!res?.ok) return false; // leave state unchanged on failure
    set((state) => {
      const escalations = state.escalations.map((e) =>
        e.id === id ? { ...e, status: 'decided', resolvedAt: Date.now() } : e,
      );
      localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
      return { escalations };
    });
    return true;
  },
}));
