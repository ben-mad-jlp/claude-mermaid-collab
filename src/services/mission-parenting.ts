/**
 * mission-parenting.ts — single source of truth for §4d mission/epic parenting.
 * Missions are roots; DELIVERABLE epics are mission children by default; BUCKET
 * epics (Inbox, Bugfix inbox) are durable intake containers and stay roots —
 * forcing them under a mission is a category error. Role comes from `kind`
 * (decision ea83ac9f); the bucket check is an IDENTITY check on a named
 * singleton, never a role regex. `parentId === null` no longer implies "epic" —
 * it means "epic OR mission".
 *
 * Pure: no DB, no `project` argument, no async. `resolveActiveMissionId` stays
 * in todo-store (it is I/O) and is passed in as an already-resolved value.
 */
import { INBOX_EPIC_TITLE } from './claimability.ts';
import { isEpic, isMission, stripLabel, kindOf, type KindBearing } from './todo-kind.ts';

export const BUGFIX_INBOX_EPIC_TITLE = 'Bugfix inbox';
export const BUCKET_EPIC_TITLES: readonly string[] = [INBOX_EPIC_TITLE, BUGFIX_INBOX_EPIC_TITLE];

/** Identity on the named singleton (stripLabel-tolerant, case-insensitive, PREFIX-match
 *  so a real suffixed bucket row — "Bugfix inbox — …" — still matches; mirrors
 *  land-authority.ts:90-92. Do NOT revert to exact match. Not a role decision. */
export const isBucketEpicTitle = (title: string | null | undefined): boolean => {
  const norm = stripLabel(title ?? '').toLowerCase();
  return BUCKET_EPIC_TITLES.some((b) => norm.startsWith(b.toLowerCase()));
};

/** kind:'epic' AND isBucket=true — bucket epics are roots, not mission children. */
export const isBucketEpic = (t: KindBearing): boolean => isEpic(t) && !!t.isBucket;

/** kind:'epic' AND isBucket=false → the epics that belong under a mission. */
export const isDeliverableEpic = (t: KindBearing): boolean => isEpic(t) && !t.isBucket;

/** Missions are always roots. */
export const missionParentId = (): null => null;

export interface EpicParentInput extends KindBearing {
  /** undefined = default (home to active mission); null = explicit root opt-out; string = explicit mission. */
  missionId?: string | null;
}

/** The §4d decision, pure. `activeMissionId` is what the caller already resolved (may be null).
 *  Precedence: explicit null → null; explicit id → id; bucket epic → null; else activeMissionId ?? null.
 *  Non-epic, non-mission input → throws (callers must not route leaves through here). */
export function resolveEpicParent(input: EpicParentInput, activeMissionId: string | null): string | null {
  if (isMission(input)) return null; // missions are durable roots
  if (!isEpic(input)) {
    throw new Error(
      `resolveEpicParent: caller bug — expected an epic or mission, got kind ${JSON.stringify(kindOf(input))}`,
    );
  }
  if (input.missionId === null) return null;       // explicit opt-out
  if (input.missionId) return input.missionId;      // explicit homing (wins over bucket check)
  if (input.isBucket) return null;  // Inbox / Bugfix inbox
  return activeMissionId ?? null;
}

export type EpicBackfillSkipReason = 'not-an-epic' | 'bucket-epic' | 'already-parented';

/** Per-epic eligibility for backfill. `null` = move it. Mirrors todo-store's ladder minus
 *  'not-found' (that is a lookup concern the caller owns). */
export function epicBackfillSkipReason(
  epic: KindBearing & { parentId?: string | null },
): EpicBackfillSkipReason | null {
  if (!isEpic(epic)) return 'not-an-epic';
  if (epic.isBucket) return 'bucket-epic';
  if (epic.parentId != null) return 'already-parented';
  return null;
}

/** Guard for the backfill target. */
export const isMissionTarget = (t: KindBearing | null | undefined): boolean => !!t && isMission(t);

/** Payloads that must resolve via `resolveEpicParent`, exercising every branch of the §4d
 *  precedence ladder with adversarial titles that prove no role regex is consulted. */
export const MISSION_PARENTING_FIXTURE: ReadonlyArray<{
  input: EpicParentInput;
  activeMissionId: string | null;
  expect: string | null;
}> = [
  { input: { kind: 'mission', title: 'Converge on X' }, activeMissionId: 'M1', expect: null },
  { input: { kind: 'epic', title: 'Deliverable', isBucket: false }, activeMissionId: 'M1', expect: 'M1' },
  { input: { kind: 'epic', title: 'Deliverable', isBucket: false }, activeMissionId: null, expect: null },
  { input: { kind: 'epic', title: 'Deliverable', isBucket: false, missionId: null }, activeMissionId: 'M1', expect: null },
  { input: { kind: 'epic', title: 'Deliverable', isBucket: false, missionId: 'M2' }, activeMissionId: 'M1', expect: 'M2' },
  { input: { kind: 'epic', title: 'Inbox', isBucket: true, missionId: 'M2' }, activeMissionId: 'M1', expect: 'M2' },
  { input: { kind: 'epic', title: 'Inbox', isBucket: true }, activeMissionId: 'M1', expect: null },
  { input: { kind: 'epic', title: 'Bugfix inbox', isBucket: true }, activeMissionId: 'M1', expect: null },
  { input: { kind: 'epic', title: 'Inbox', isBucket: true }, activeMissionId: 'M1', expect: null },
  { input: { kind: 'epic', title: 'Inbox', isBucket: true }, activeMissionId: 'M1', expect: null },
  { input: { kind: 'epic', title: 'deliverable, column wins', isBucket: false }, activeMissionId: 'M1', expect: 'M1' },
];
