import { create } from 'zustand';

/**
 * workerFabricStore — the live, per-todo state of the in-process worker fabric
 * (design-worker-fabric-ui §6.3). It is the single source the work-graph nodes read
 * to decorate themselves with the current phase, the routing decision (which
 * provider/model ran it and why), accumulated cost, and liveness.
 *
 * Live-update contract (§6.1): structure comes over the `worker_phase` WebSocket
 * event (applyPhase); a full snapshot is hydrated from GET /api/worker-lanes on mount
 * and reconnect (hydrate). The transcript poll (GrokTranscript) carries the noisy
 * per-step text — NOT this store — so node churn stays low.
 */

export interface PhaseRoute {
  provider?: string;
  model?: string;
  source?: string;
  winningScope?: string;
}

export interface LaneState {
  todoId: string;
  project?: string;
  session?: string;
  /** The phase currently running (or last seen): sizegate|research|authortests|implement|verify|review. */
  phase?: string;
  lifecycle?: 'start' | 'end';
  route?: PhaseRoute;
  /** Accumulated USD across this run's completed phases. */
  runCostUsd: number;
  /** Per-phase cost roll-up (from hydration / ledger). */
  byPhase?: Record<string, { usd: number }>;
  alive: boolean;
  lastTs: number;
}

/** The shape of a `worker_phase` WS message (mirrors WSMessage in src/websocket/handler.ts). */
export interface WorkerPhaseEvent {
  type: 'worker_phase';
  project: string;
  session: string;
  todoId: string;
  epicId?: string;
  lifecycle: 'start' | 'end';
  role: string;
  provider?: string;
  model?: string;
  source?: string;
  winningScope?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  costUsd?: number;
  steps?: number;
  ts: number;
}

export interface HydratedLane {
  todoId: string;
  session?: string;
  title?: string;
  alive: boolean;
  runCostUsd: number;
  byPhase?: Record<string, { usd: number }>;
}

interface WorkerFabricState {
  /** Live lanes keyed by todoId. */
  lanes: Record<string, LaneState>;
  applyPhase: (e: WorkerPhaseEvent) => void;
  hydrate: (lanes: HydratedLane[], project?: string) => void;
  /** Fetch the live-lanes snapshot for a project and fold it in (mount/reconnect). */
  hydrateFromServer: (project: string) => Promise<void>;
  reset: () => void;
}

export const useWorkerFabricStore = create<WorkerFabricState>((set, get) => ({
  lanes: {},

  applyPhase: (e) =>
    set((s) => {
      const prev = s.lanes[e.todoId];
      const route: PhaseRoute = { provider: e.provider, model: e.model, source: e.source, winningScope: e.winningScope };
      const runCostUsd = (prev?.runCostUsd ?? 0) + (e.lifecycle === 'end' ? e.costUsd ?? 0 : 0);
      const byPhase = { ...(prev?.byPhase ?? {}) };
      if (e.lifecycle === 'end' && e.costUsd != null) {
        byPhase[e.role] = { usd: (byPhase[e.role]?.usd ?? 0) + e.costUsd };
      }
      return {
        lanes: {
          ...s.lanes,
          [e.todoId]: {
            todoId: e.todoId,
            project: e.project,
            session: e.session,
            phase: e.role,
            lifecycle: e.lifecycle,
            route,
            runCostUsd,
            byPhase,
            alive: true,
            lastTs: e.ts,
          },
        },
      };
    }),

  hydrate: (lanes, project) =>
    set((s) => {
      const next = { ...s.lanes };
      const seen = new Set<string>();
      for (const l of lanes) {
        seen.add(l.todoId);
        const prev = next[l.todoId];
        next[l.todoId] = {
          todoId: l.todoId,
          project: project ?? prev?.project,
          session: l.session ?? prev?.session,
          phase: prev?.phase,
          lifecycle: prev?.lifecycle,
          route: prev?.route,
          // Ledger is authoritative for cost on hydration (§6.1 reconciliation).
          runCostUsd: l.runCostUsd,
          byPhase: l.byPhase ?? prev?.byPhase,
          alive: l.alive,
          lastTs: prev?.lastTs ?? 0,
        };
      }
      // A lane no longer reported is no longer live — but only retire lanes for the
      // project we just hydrated (a per-project snapshot must not retire other projects).
      for (const id of Object.keys(next)) {
        if (seen.has(id) || !next[id].alive) continue;
        if (project && next[id].project && next[id].project !== project) continue;
        next[id] = { ...next[id], alive: false };
      }
      return { lanes: next };
    }),

  hydrateFromServer: async (project) => {
    try {
      const res = await fetch(`/api/worker-lanes?project=${encodeURIComponent(project)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { lanes?: HydratedLane[] };
      if (data.lanes) get().hydrate(data.lanes, project);
    } catch {
      /* hydration is best-effort; the WS stream keeps the store fresh */
    }
  },

  reset: () => set({ lanes: {} }),
}));
