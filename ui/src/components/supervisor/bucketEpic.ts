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
 * Identified by title convention today ([EPIC] Inbox / [EPIC] Bugfix inbox / any
 * title with the word "inbox"). Swap this for a real per-todo marker if/when the
 * auto-created inbox epics carry one — every call site goes through here.
 */
export function isBucketEpic(title?: string | null): boolean {
  return !!title && /\binbox\b/i.test(title);
}
