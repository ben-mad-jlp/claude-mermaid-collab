import { listMissions, isMissionTerminal, type MissionSummary } from './mission-store.ts';

/** The roles a session can be RESUMED into. Extend as planner/worker earn it —
 *  conductor is the only demonstrated case (a session that owns a live mission). */
export type SessionRole = 'conductor';

/** Skill to load for a role, by name as the Skill tool expects it. */
export const ROLE_SKILL: Record<SessionRole, string> = { conductor: 'conductor' };

export interface SessionRoleDeps {
  listMissions?: (project: string) => MissionSummary[];
}

/**
 * Resolve a session's role from DURABLE state alone — no prompt, no prose.
 *
 * A session that owns (or is assigned) an ACTIVE, NON-TERMINAL mission IS the
 * conductor of that mission; that is already the exact predicate the mission-loop
 * pass drives on. Reading it at reload is what keeps the steward alive across a
 * context recycle instead of coming back as a bystander.
 *
 * Fails OPEN to `null` (plain vibe session) on any error — a role we cannot prove
 * must never be asserted, and a broken mission.db must never block a resume.
 */
export function resolveSessionRole(project: string, session: string, deps: SessionRoleDeps = {}): SessionRole | null {
  try {
    const list = (deps.listMissions ?? listMissions)(project);
    const owns = list.some(
      (m) => m.mission.active && !isMissionTerminal(m.mission) &&
        (m.ownerSession === session || m.assigneeSession === session),
    );
    return owns ? 'conductor' : null;
  } catch {
    return null;
  }
}
