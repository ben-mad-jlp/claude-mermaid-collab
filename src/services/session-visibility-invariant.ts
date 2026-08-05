/**
 * Diagnostic module proving the invariant: "a live session must never be
 * invisible in every UI surface simultaneously" (constraint 1ffb48cd).
 *
 * Read-only aggregation over existing stores; produces no mutations.
 */

import type { SessionStatusRow, ClaudeStatus } from './session-status-store';
import { getStatuses } from './session-status-store';
import type { WatchedSession } from './supervisor-store';
import { listWatchedSessions, isWorkerSessionName } from './supervisor-store';
import { sessionRegistry } from './session-registry';

/** Live session window: 15 minutes in milliseconds. */
export const LIVE_WINDOW_MS = 15 * 60_000;

/**
 * Surface membership for a session across all UI surfaces.
 * `supervisorPanel` and `watchingList` read the same data source today,
 * but are kept distinct per spec to make a future feed-split visible as
 * one field diverging without touching this predicate's shape.
 */
export interface SurfaceMembership {
  watchingList: boolean;
  supervisorPanel: boolean;
  picker: boolean;
}

/**
 * A live session invisible in every UI surface — a violation of the
 * invariant that requires human attention.
 */
export interface InvisibleLiveSession {
  project: string;
  session: string;
  status: ClaudeStatus;
  updatedAt: number;
  ageMs: number;
  surfaces: SurfaceMembership;
  reason: string;
}

/**
 * Summary of session visibility across all sources.
 */
export interface SessionVisibilityReport {
  checkedSessions: number;
  liveSessions: number;
  invisible: InvisibleLiveSession[];
  violationCount: number;
}

/**
 * Input sources for visibility analysis: session statuses, watched sessions,
 * and the session registry.
 */
export interface SessionVisibilitySources {
  statuses: SessionStatusRow[];
  watched: WatchedSession[];
  registrySessions: Array<{ project: string; session: string }>;
  now: number;
}

/**
 * Decide whether a session status row is a live candidate (active status
 * and within the liveness window). Shared guard logic for both
 * `findInvisibleLiveSessions` and `summarizeSessionVisibility`.
 */
function isLiveCandidate(row: SessionStatusRow, now: number): boolean {
  if (row.status !== 'active') return false;
  if (now - row.updatedAt > LIVE_WINDOW_MS) return false;
  if (isWorkerSessionName(row.session)) return false;
  return true;
}

/**
 * Pure core: find all live sessions invisible in every UI surface.
 * Union semantics: a session is invisible only when watchingList AND
 * supervisorPanel AND picker are ALL false.
 */
export function findInvisibleLiveSessions(src: SessionVisibilitySources): InvisibleLiveSession[] {
  const invisible: InvisibleLiveSession[] = [];

  for (const row of src.statuses) {
    if (!isLiveCandidate(row, src.now)) continue;

    const watchingList = src.watched.some(
      (w) => w.project === row.project && w.session === row.session
    );
    const supervisorPanel = watchingList; // Same source today, distinct field for future.
    const picker =
      src.registrySessions.some(
        (r) => r.project === row.project && r.session === row.session
      ) && !watchingList;

    // Violation only if on NO surface (all false).
    if (watchingList || supervisorPanel || picker) continue;

    const ageMs = src.now - row.updatedAt;
    const reason = [
      !watchingList && 'not in watched_session',
      !src.registrySessions.some((r) => r.project === row.project && r.session === row.session) &&
        'not in session-registry list()',
    ]
      .filter(Boolean)
      .join('; ');

    invisible.push({
      project: row.project,
      session: row.session,
      status: row.status,
      updatedAt: row.updatedAt,
      ageMs,
      surfaces: { watchingList, supervisorPanel, picker },
      reason,
    });
  }

  return invisible;
}

/**
 * Wrapper: counts `checkedSessions` and `liveSessions`, then calls the pure core
 * to identify violations.
 */
export function summarizeSessionVisibility(
  src: SessionVisibilitySources
): SessionVisibilityReport {
  const checkedSessions = src.statuses.length;
  const liveSessions = src.statuses.filter((row) => isLiveCandidate(row, src.now))
    .length;
  const invisible = findInvisibleLiveSessions(src);

  return {
    checkedSessions,
    liveSessions,
    invisible,
    violationCount: invisible.length,
  };
}

/**
 * DB-backed wrapper: collects live session data from the store layer and
 * routes it through the pure summary function.
 *
 * @param project Project path to check sessions for.
 * @param deps Optional injectable dependencies (for testing and flexibility).
 * @returns Promise resolving to a visibility report.
 */
export async function checkSessionVisibility(
  project: string,
  deps?: {
    now?: number;
    statusesImpl?: (p: string) => SessionStatusRow[];
    watchedImpl?: () => WatchedSession[];
    registryImpl?: () => Promise<Array<{ project: string; session: string }>>;
  }
): Promise<SessionVisibilityReport> {
  const now = deps?.now ?? Date.now();
  const statusesImpl = deps?.statusesImpl ?? getStatuses;
  const watchedImpl = deps?.watchedImpl ?? listWatchedSessions;
  const registryImpl = deps?.registryImpl ?? (async () =>
    (await sessionRegistry.list()).map((s) => ({
      project: s.project,
      session: s.session,
    }))
  );

  const statuses = statusesImpl(project);
  const watched = watchedImpl();
  const registrySessions = await registryImpl();

  const src: SessionVisibilitySources = {
    statuses,
    watched,
    registrySessions,
    now,
  };

  return summarizeSessionVisibility(src);
}
