/**
 * todo-kind-backfill.ts — QUARANTINE for the title→kind inference used by the ONE-WAY
 * stage-C migration (decision e852fb0c / ea83ac9f).
 *
 * BOMB 1: `kindFromTitle` used to be called at INSERT time (todo-store.ts). Stage C strips
 * the role prefix from stored titles, so after this migration an inferred kind is WRONG:
 *   kindFromTitle('Bugfix inbox')    -> 'leaf'  (the row is an 'epic')
 *   kindFromTitle('Land X → master') -> 'leaf'  (the row is a 'land')
 * Every epic/mission/[LAND] created after the strip would be misclassified, silently.
 *
 * Therefore: this function may ONLY be used to interpret a title written BEFORE the strip —
 * i.e. by the backfill in `initSchema`, and by the tests/fixtures that assert parity with it.
 * It is a runtime predicate for NO ONE. Role truth is the `kind` column; read it via
 * `kindOf()` in ./todo-kind.ts, which throws when `kind` is absent.
 *
 * Pure module: no DB, no value import from any module on a write path. The `TodoKind` import
 * is type-only and erased at compile time, so this file adds no edge to the ESM graph.
 */
import type { TodoKind } from './claimability.ts';
export type { TodoKind };

/** Anchored, whitespace-tolerant, case-insensitive. Mirrors `TRIM(title) LIKE '[X]%'` in
 *  `initSchema`. Role prefixes ONLY — `[UI]`, `[BUG]`, `[kind C]` are human TOPIC tags. */
const MISSION_RE = /^\s*\[MISSION\]/i;
const EPIC_RE    = /^\s*\[EPIC\]/i;
const LAND_RE    = /^\s*\[LAND\]/i;

/** The single role-prefix pattern, exported for migration/test use. Never `\[[^\]]+\]`. */
export const ROLE_PREFIX_RE = /^\s*\[(?:MISSION|EPIC|LAND)\]\s*/i;

/**
 * @deprecated BACKFILL ONLY — never at insert, never as a runtime predicate.
 * Infers the legacy role from a PRE-STRIP title. TOTAL: always returns a kind.
 * Checked mission→epic→land→leaf; `'[MISSION] [EPIC] x'` is a mission.
 */
export function kindFromTitle(title: string | null | undefined): TodoKind {
  const t = title ?? '';
  if (MISSION_RE.test(t)) return 'mission';
  if (EPIC_RE.test(t)) return 'epic';
  if (LAND_RE.test(t)) return 'land';
  return 'leaf';
}

/**
 * @deprecated BACKFILL ONLY. Removes exactly one leading ROLE prefix from a pre-strip title.
 * Idempotent (a second application changes nothing) and topic-tag safe:
 * `'[UI] Plan list doesn't refresh'` is returned verbatim.
 * NOTE: for DISPLAY, use `stripLabel` from ./todo-kind.ts — this copy exists so the migration
 * has no dependency on the render module.
 */
export function stripRolePrefix(title: string | null | undefined): string {
  return (title ?? '').replace(ROLE_PREFIX_RE, '').trim();
}
