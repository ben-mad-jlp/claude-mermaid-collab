// Single-source derivation of conductor-pass liveness for a mission, shared by
// mission-diagnostic's buildMissionDiagnostic and mission-tools' get_mission handler.
import { listConductorPasses, type ConductorPassArm } from './conductor-pass-journal.js';

/** Latest conductor-pass telemetry for a mission, derived from the durable conductor_pass
 *  journal (newest-first). Degrades to the all-null/zero shape below on any read failure. */
export interface MissionDiagnosticConductorPass {
  /** startedAt of the most recent FINALIZED pass (endedAt != null), or null. */
  lastPassAt: number | null;
  /** arm of that finalized pass, or null. */
  lastArm: ConductorPassArm | null;
  /** outcome of that finalized pass, or null. */
  lastOutcome: string | null;
  /** ran flag of that finalized pass, or null. */
  ran: boolean | null;
  /** true when the newest row is still open (endedAt == null) — a pass is mid-flight. */
  isInflight: boolean;
  /** contiguous count of newest FINALIZED passes with outcome === 'debounced'. */
  debouncedStreak: number;
  /** seconds since lastPassAt (now() - lastPassAt)/1000, or null when no finalized pass. */
  staleSeconds: number | null;
}

/**
 * conductorPass — latest pass telemetry from the durable journal (newest-first). Any throw
 * degrades to the all-null/zero shape; empty rows also read that shape (never "inflight").
 */
export function deriveConductorPassLiveness(
  project: string,
  missionId: string,
  deps?: { now?: () => number },
): MissionDiagnosticConductorPass {
  const now = deps?.now ?? Date.now;
  try {
    const rows = listConductorPasses(project, { missionId, limit: 20 });
    // The newest row, if unfinalized, is the mission's in-flight pass and is EXCLUDED from
    // the streak/last-X reads (which describe SETTLED history).
    const isInflight = rows.length > 0 && rows[0].endedAt == null;
    const finalized = rows.filter((r) => r.endedAt != null);
    const lastPassAt = finalized[0]?.startedAt ?? null;
    let debouncedStreak = 0;
    for (const r of finalized) {
      if (r.outcome === 'debounced') debouncedStreak++;
      else break;
    }
    return {
      lastPassAt,
      lastArm: finalized[0]?.arm ?? null,
      lastOutcome: finalized[0]?.outcome ?? null,
      ran: finalized[0]?.ran ?? null,
      isInflight,
      debouncedStreak,
      staleSeconds: lastPassAt == null ? null : (now() - lastPassAt) / 1000,
    };
  } catch {
    return {
      lastPassAt: null,
      lastArm: null,
      lastOutcome: null,
      ran: null,
      isInflight: false,
      debouncedStreak: 0,
      staleSeconds: null,
    };
  }
}
