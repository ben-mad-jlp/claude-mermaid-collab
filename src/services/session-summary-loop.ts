/**
 * Session-summary loop — Phase 2 of design-zen-mode.
 *
 * Zero-LLM / purely structural: tmux pane hashing + quiet-window counters +
 * deterministic state machine. Emits `session_summary_updated` WS messages with
 * a graded `progressState` and `paneSeenAt` timestamp — no text summary yet (that
 * is a later phase). Durable-trust sibling of `session-subscriptions.ts` and
 * `session-notification-tick.ts`.
 *
 * The loop enumerates INTERACTIVE watched sessions only (from `listSupervised()`,
 * filtered to watched projects). It deliberately does NOT touch the in_progress
 * todo list from coordinator-live, and does NOT operate on headless leaves.
 *
 * The in-memory cache is fully rebuildable: a restart re-seeds. The first tick
 * after a restart yields `active` or `quiet`; it never produces a false `stalled`
 * or `wedged` on first sight.
 */

import { createHash } from 'crypto';
import { listSupervised } from './supervisor-store.js';
import { tmuxBaseName } from './tmux-naming.js';
import { mux } from './session-mux/index.js';
import { argvCapturePane } from './session-mux/tmux-argv.js';
import { getWebSocketHandler, hasWebSocketHandler } from './ws-handler-manager.js';
import type { WSMessage } from '../websocket/handler.js';
import { isActivelyWorking, detectPermissionPrompt } from '../agent/adapters/claude-code.js';
import { diagnoseClaimSuppression } from './coordinator-live.js';
import { systemStatus } from './system-status.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';

export interface SessionSummaryEntry {
  project: string;
  session: string;
  tmux: string;
  paneHash: string;
  paneSeenAt: number;
  quietWindows: number;
  progressState: ProgressState;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// In-memory cache (rebuildable)
// ---------------------------------------------------------------------------

const cache = new Map<string, SessionSummaryEntry>();

export function getSessionSummary(project: string, session: string): SessionSummaryEntry | undefined {
  return cache.get(`${project}::${session}`);
}

export function listSessionSummaries(): SessionSummaryEntry[] {
  return [...cache.values()];
}

export function __resetSummaryState(): void {
  cache.clear();
  STALL_WINDOWS = DEFAULT_STALL_WINDOWS;
  WEDGE_WINDOWS = DEFAULT_WEDGE_WINDOWS;
}

// ---------------------------------------------------------------------------
// Tunable thresholds
// ---------------------------------------------------------------------------

const DEFAULT_STALL_WINDOWS = 3; // ~90s at 30s tick
const DEFAULT_WEDGE_WINDOWS = 6; // ~3min at 30s tick

let STALL_WINDOWS = DEFAULT_STALL_WINDOWS;
let WEDGE_WINDOWS = DEFAULT_WEDGE_WINDOWS;

export function setSummaryThresholds(t: { stallWindows?: number; wedgeWindows?: number }): void {
  if (t.stallWindows != null) STALL_WINDOWS = t.stallWindows;
  if (t.wedgeWindows != null) WEDGE_WINDOWS = t.wedgeWindows;
}

export function getSummaryThresholds(): { stallWindows: number; wedgeWindows: number } {
  return { stallWindows: STALL_WINDOWS, wedgeWindows: WEDGE_WINDOWS };
}

// ---------------------------------------------------------------------------
// Injectable deps seam
// ---------------------------------------------------------------------------

export interface SummaryTickDeps {
  listSessions?: () => Array<{ project: string; session: string; launchProject?: string | null }>;
  watchedProjects?: () => Set<string>;
  capture?: (tmux: string) => Promise<string>;
  isActive?: (pane: string) => boolean;
  isWaiting?: (pane: string) => boolean;
  diagnoseSuppression?: (project: string) => Promise<{ suppressed: boolean; claimable: number; projectGate: string | null }>;
  systemStatus?: (project: string) => Promise<{ fleet: { inProgress: number; working: number }; orchestrator: { poolOccupancy: number } }>;
  broadcast?: (msg: unknown) => void;
  hasWs?: () => boolean;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Local capture helper (mirrors coordinator-live.ts:354 — kept decoupled)
// ---------------------------------------------------------------------------

async function capturePaneLocal(tmuxName: string): Promise<string> {
  try {
    const proc = Bun.spawn(mux.cmd(argvCapturePane(tmuxName, 100)), {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [stdout] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
      proc.exited,
    ]);
    return stdout;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function runSessionSummaryTick(deps: SummaryTickDeps = {}): Promise<{
  scanned: number;
  emitted: number;
  byState: Record<ProgressState, number>;
}> {
  const listSessions = deps.listSessions ?? listSupervised;
  const watchedProjects = deps.watchedProjects ?? (() => new Set<string>());
  const capture = deps.capture ?? capturePaneLocal;
  const isActive = deps.isActive ?? isActivelyWorking;
  const isWaiting = deps.isWaiting ?? ((pane: string) => detectPermissionPrompt(pane).isPermission);
  const diagnoseSuppression =
    deps.diagnoseSuppression ??
    (async (project: string) => {
      const r = await diagnoseClaimSuppression(project);
      return { suppressed: r.claimable === 0, claimable: r.claimable, projectGate: r.projectGate };
    });
  const getSystemStatus =
    deps.systemStatus ??
    (async (project: string) => {
      return systemStatus(project);
    });
  const broadcast =
    deps.broadcast ??
    ((msg: unknown) => {
      getWebSocketHandler()?.broadcast(msg as WSMessage);
    });
  const wsPresent = deps.hasWs ?? hasWebSocketHandler;
  const now = deps.now ?? Date.now;

  const watched = watchedProjects();
  const sessions = listSessions().filter((s) => watched.has(s.project));

  const byState: Record<ProgressState, number> = {
    active: 0,
    quiet: 0,
    stalled: 0,
    wedged: 0,
    unknown: 0,
  };
  let emitted = 0;

  // Track which (project, session) keys are still alive for pruning.
  const liveKeys = new Set<string>();

  for (const row of sessions) {
    const project = row.project;
    const session = row.session;
    const launchProject = (row as { launchProject?: string | null }).launchProject ?? null;
    const tmux = tmuxBaseName(launchProject ?? project, session);
    const key = `${project}::${session}`;
    liveKeys.add(key);

    const ts = now();
    const prev = cache.get(key);

    // WS-gap → unknown (no live corroboration).
    if (!wsPresent()) {
      const entry: SessionSummaryEntry = {
        project,
        session,
        tmux,
        paneHash: prev?.paneHash ?? '',
        paneSeenAt: prev?.paneSeenAt ?? ts,
        quietWindows: prev?.quietWindows ?? 0,
        progressState: 'unknown',
        updatedAt: ts,
      };
      cache.set(key, entry);
      byState.unknown++;
      broadcast({ type: 'session_summary_updated', project, session, progressState: 'unknown', paneSeenAt: entry.paneSeenAt, updatedAt: ts });
      emitted++;
      continue;
    }

    const pane = await capture(tmux);

    // Capture-fail → unknown; reset quietWindows so a failure streak can't masquerade
    // as a quiet streak (the failure is informative: we couldn't read the pane at all).
    if (pane === '') {
      const entry: SessionSummaryEntry = {
        project,
        session,
        tmux,
        paneHash: '',
        paneSeenAt: prev?.paneSeenAt ?? ts,
        quietWindows: 0,
        progressState: 'unknown',
        updatedAt: ts,
      };
      cache.set(key, entry);
      byState.unknown++;
      broadcast({ type: 'session_summary_updated', project, session, progressState: 'unknown', paneSeenAt: entry.paneSeenAt, updatedAt: ts });
      emitted++;
      continue;
    }

    // Hash and apply the change-gate.
    const hash = createHash('sha1').update(pane).digest('hex');
    const changed = !prev || prev.paneHash !== hash;

    let paneSeenAt: number;
    let quietWindows: number;

    if (changed) {
      paneSeenAt = ts;
      quietWindows = 0;
    } else {
      paneSeenAt = prev!.paneSeenAt;
      quietWindows = (prev?.quietWindows ?? 0) + 1;
    }

    // Grade the state.
    let progressState: ProgressState;

    if (changed) {
      progressState = 'active';
    } else if (quietWindows < STALL_WINDOWS) {
      progressState = 'quiet';
    } else {
      // At or above stall threshold.
      if (isWaiting(pane)) {
        // A worker at a human/permission prompt is not stalled — clamp to quiet.
        progressState = 'quiet';
      } else if (quietWindows < WEDGE_WINDOWS || isActive(pane)) {
        // isActive (spinner present) also keeps it at stalled, not wedged — still
        // technically working even if the pane hasn't changed text.
        progressState = 'stalled';
      } else {
        // quietWindows >= WEDGE_WINDOWS and not actively spinning. Corroborate.
        let progressStateCandidate: ProgressState = 'wedged';
        try {
          const [suppression, sysStatus] = await Promise.all([
            diagnoseSuppression(project),
            getSystemStatus(project),
          ]);
          // If either corroborator says something is legitimately in flight → downgrade.
          const laneBlocked = suppression.claimable === 0 && suppression.projectGate !== null;
          const buildingOrWaiting =
            sysStatus.fleet.working > 0 ||
            sysStatus.fleet.inProgress > 0 ||
            sysStatus.orchestrator.poolOccupancy > 0;
          if (laneBlocked || buildingOrWaiting) {
            progressStateCandidate = 'stalled';
          }
        } catch {
          // Corroborators failed — never fabricate wedged, default to stalled.
          progressStateCandidate = 'stalled';
        }
        progressState = progressStateCandidate;
      }
    }

    const entry: SessionSummaryEntry = {
      project,
      session,
      tmux,
      paneHash: hash,
      paneSeenAt,
      quietWindows,
      progressState,
      updatedAt: ts,
    };
    cache.set(key, entry);
    byState[progressState]++;
    broadcast({ type: 'session_summary_updated', project, session, progressState, paneSeenAt, updatedAt: ts });
    emitted++;
  }

  // Prune cache entries whose session is no longer supervised/watched.
  for (const key of cache.keys()) {
    if (!liveKeys.has(key)) {
      cache.delete(key);
    }
  }

  return { scanned: sessions.length, emitted, byState };
}
