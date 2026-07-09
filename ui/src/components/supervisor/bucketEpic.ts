/**
 * isBucketEpic — is this epic a CATCH-ALL bucket (the Inbox / Bugfix inbox) rather
 * than a cohesive deliverable epic?
 *
 * A bucket holds unrelated ad-hoc items, so the "show an active epic's completed
 * children as progress" rule doesn't apply — its completed children are just history
 * and should obey the Show-completed toggle (orphan semantics), and it gets a
 * "Clear completed" housekeeping action. A deliverable epic (an arc with a LAND
 * leaf) keeps the always-show-completed behavior.
 *
 * WHY THIS STILL READS A TITLE (deliberate, reviewed under the kind-column migration):
 * bucket-ness is a TOPIC, not a ROLE. The `kind` column answers only "what role does
 * this node play in the work graph" (mission / epic / land / leaf), and a bucket epic
 * is a perfectly ordinary epic — same claim, rollup and land semantics. It differs in
 * one presentational rule, nothing more. Decided (kind E): documented title convention,
 * NOT a per-todo marker — a bucket is a topic and no `kind` value can express it. So
 * this predicate does NOT belong in `ui/src/lib/todoKind.ts`, and callers must decide
 * the epic role via `isEpic` from that module before consulting this function.
 *
 * It is also strip-safe: the migration only removes the leading bracket label from
 * stored titles, so "Inbox" and "Bugfix inbox" keep matching afterwards. See
 * bucketEpic.test.ts — the invariant is asserted, not assumed.
 *
 * Swap this for a real per-todo bucket marker if/when the auto-created inbox epics
 * carry one — every call site goes through here.
 */
export function isBucketEpic(title?: string | null): boolean {
  return !!title && /\binbox\b/i.test(title);
}
