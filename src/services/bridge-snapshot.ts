import { listWatchedProjects, type WatchedProject, listOpenEscalations, type Escalation } from './supervisor-store.js';
import { listTodos, type Todo } from './todo-store.js';
import { listMissions, type MissionSummary } from './mission-store.js';
import { specCoverage, type CoverageRollup } from './spec-coverage.js';
import { listCampaignsForSnapshot, type BridgeCampaign } from './campaign-snapshot.js';
import { listJobs, type AsyncJobRow } from './async-job-store.js';

export type BridgeSnapshotView = 'full' | 'core';

export interface LandInFlight {
  jobId: string;
  epicId: string;
  startedAtMs: number;
}

export interface BridgeSnapshotOptions {
  view?: BridgeSnapshotView;
  serverIds?: string[];
  pagination?: {
    todosLimit?: number;
    missionsLimit?: number;
    missionsCursor?: string;
  };
  deps?: {
    listWatchedProjects?: typeof listWatchedProjects;
    listTodos?: typeof listTodos;
    listMissions?: typeof listMissions;
    listOpenEscalations?: typeof listOpenEscalations;
    specCoverage?: typeof specCoverage;
    listCampaignsForSnapshot?: typeof listCampaignsForSnapshot;
    snapshotSummaryMessages?: () => Array<Record<string, unknown>>;
    listJobs?: typeof listJobs;
  };
}

export interface BridgeSnapshot {
  projects: WatchedProject[];
  todos: Todo[];
  missions: MissionSummary[];
  openEscalations: Escalation[];
  coverage: CoverageRollup | null;
  summaries: Array<Record<string, unknown>>;
  campaigns: BridgeCampaign[];
  landsInFlight: LandInFlight[];
}

const DEFAULT_BRIDGE_TODOS_LIMIT = 200;
const MAX_BRIDGE_TODOS_LIMIT = 1000;
const DEFAULT_BRIDGE_MISSIONS_LIMIT = 50;
const MAX_BRIDGE_MISSIONS_LIMIT = 200;

export async function buildBridgeSnapshot(
  project: string,
  opts?: BridgeSnapshotOptions,
): Promise<BridgeSnapshot> {
  const view = opts?.view ?? 'full';
  const serverIds = opts?.serverIds;
  const pagination = opts?.pagination;
  const deps = opts?.deps;

  // Injected dependencies (testability)
  const _listWatchedProjects = deps?.listWatchedProjects ?? listWatchedProjects;
  const _listTodos = deps?.listTodos ?? listTodos;
  const _listMissions = deps?.listMissions ?? listMissions;
  const _listOpenEscalations = deps?.listOpenEscalations ?? listOpenEscalations;
  const _specCoverage = deps?.specCoverage ?? specCoverage;
  const _listCampaignsForSnapshot = deps?.listCampaignsForSnapshot ?? listCampaignsForSnapshot;
  const _snapshotSummaryMessages = deps?.snapshotSummaryMessages;
  const _listJobs = deps?.listJobs ?? listJobs;

  const result: BridgeSnapshot = {
    projects: [],
    todos: [],
    missions: [],
    openEscalations: [],
    coverage: null,
    summaries: [],
    campaigns: [],
    landsInFlight: [],
  };

  // Read projects
  try {
    result.projects = _listWatchedProjects();
  } catch {
    // Degrade to []
  }

  // Read todos
  try {
    const allTodos = _listTodos(project, { includeCompleted: true });
    const todosLimit = pagination?.todosLimit ?? DEFAULT_BRIDGE_TODOS_LIMIT;
    const clampedLimit = Math.min(todosLimit, MAX_BRIDGE_TODOS_LIMIT);
    result.todos = allTodos.slice(0, clampedLimit);
  } catch {
    // Degrade to []
  }

  // Read missions
  try {
    const allMissions = _listMissions(project, { withFacts: false });
    const missionsLimit = pagination?.missionsLimit ?? DEFAULT_BRIDGE_MISSIONS_LIMIT;
    const clampedLimit = Math.min(missionsLimit, MAX_BRIDGE_MISSIONS_LIMIT);
    const cursor = pagination?.missionsCursor ?? undefined;
    const start = cursor ? allMissions.findIndex((m) => m.node.id === cursor) + 1 : 0;
    result.missions = allMissions.slice(start, start + clampedLimit);
  } catch {
    // Degrade to []
  }

  // Read open escalations
  try {
    const allEscalations = _listOpenEscalations();
    if (serverIds && serverIds.length > 0) {
      const serverIdSet = new Set(serverIds);
      result.openEscalations = allEscalations.filter((e) => serverIdSet.has(e.serverId));
    } else {
      result.openEscalations = allEscalations;
    }
  } catch {
    // Degrade to []
  }

  // Read coverage (only in 'full' view)
  if (view === 'full') {
    try {
      result.coverage = _specCoverage(project);
    } catch {
      // Degrade to null
    }
  }

  // Read campaigns
  try {
    result.campaigns = _listCampaignsForSnapshot(project);
  } catch {
    // Degrade to []
  }

  // Read lands in flight
  try {
    const jobs = _listJobs(project, { status: 'running', kind: 'land-epic' });
    result.landsInFlight = jobs
      .filter((row) => row.targetId !== null && row.targetId !== '')
      .map((row) => ({
        jobId: row.id,
        epicId: row.targetId!,
        startedAtMs: row.createdAt,
      }));
  } catch {
    // Degrade to []
  }

  // Read summaries (only in 'full' view)
  if (view === 'full' && _snapshotSummaryMessages) {
    try {
      result.summaries = _snapshotSummaryMessages();
    } catch {
      // Degrade to []
    }
  }

  return result;
}
