/**
 * conductor-hold-classification — pure vocabulary + classifier for sibling-collision holds.
 * Mirroring conductor-signature.ts's "no store/db/git imports — runtime-dependency-free"
 * discipline. Exports the hold reason token and a selector that maps it to the 'held' outcome.
 */

/** The literal heldReason token for a pass that stopped because its serve target is held
 *  on a sibling-collision condition. No provenance suffix like DUP_OF_LANDED carries. */
export const SIBLING_COLLISION_HOLD = 'sibling-collision';

/**
 * Pure selector: returns 'held' exactly when heldReason matches SIBLING_COLLISION_HOLD,
 * null for every other value (including null, 'manual', 'retry-exhausted', 'migrated-park',
 * and any DUP_OF_LANDED-prefixed handle). Used to decide whether a pass outcome should
 * render as a held escalation.
 *
 * @param heldReason - The heldReason value (string or null) to classify.
 * @returns 'held' if the reason is SIBLING_COLLISION_HOLD, null otherwise.
 */
export function holdOutcomeFor(heldReason: string | null): 'held' | null {
  return heldReason === SIBLING_COLLISION_HOLD ? 'held' : null;
}
