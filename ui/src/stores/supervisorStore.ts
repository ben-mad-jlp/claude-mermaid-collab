import { create } from 'zustand';

/**
 * Supervisor store (v2 global model).
 *
 * In v2 the supervisor surface is global rather than scoped to a single
 * supervisor session. The app tracks a flat set of watched projects, a roadmap
 * keyed by project, a flat list of escalations, and a flat list of locks. All of
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

export interface Escalation {
  id: string;
  project: string;
  session: string;
  kind: string;
  questionText: string;
  status: string;
  createdAt: number;
  resolvedAt?: number | null;
}

export interface Lock {
  project: string;
  session: string;
  lockedAt: number;
  reason?: string;
  expiresAt?: number;
}

const PROJECTS_KEY = 'supervisor-projects';
const ROADMAP_KEY = 'supervisor-roadmap';
const ESCALATIONS_KEY = 'supervisor-escalations';
const LOCKS_KEY = 'supervisor-locks';

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
  escalations: Escalation[];
  locks: Lock[];
  loadProjects: (serverId: string) => Promise<void>;
  addProject: (serverId: string, project: string) => Promise<void>;
  removeProject: (serverId: string, project: string) => Promise<void>;
  loadRoadmap: (serverId: string, project: string) => Promise<void>;
  loadEscalations: (serverId: string) => Promise<void>;
  resolveEscalation: (serverId: string, id: string, status: string) => Promise<void>;
  loadLocks: (serverId: string) => Promise<void>;
}

export const useSupervisorStore = create<SupervisorState>((set, get) => ({
  watchedProjects: hydrate<WatchedProject[]>(PROJECTS_KEY, []),
  roadmapByProject: hydrate<Record<string, RoadmapItem[]>>(ROADMAP_KEY, {}),
  escalations: hydrate<Escalation[]>(ESCALATIONS_KEY, []),
  locks: hydrate<Lock[]>(LOCKS_KEY, []),

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

  loadEscalations: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/escalations', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const escalations: Escalation[] = res.body?.escalations ?? [];
    localStorage.setItem(ESCALATIONS_KEY, JSON.stringify(escalations));
    set({ escalations });
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

  loadLocks: async (serverId) => {
    const res = await invoke(serverId, '/api/supervisor/locks', 'GET');
    if (!res?.ok) return; // keep prior (cached) state on failure
    const locks: Lock[] = res.body?.locks ?? [];
    localStorage.setItem(LOCKS_KEY, JSON.stringify(locks));
    set({ locks });
  },
}));
