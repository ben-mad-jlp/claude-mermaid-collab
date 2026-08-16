/** Condition keys for the leaf-executor raise sites (8 `deps.escalate` call sites).
 *
 *  Mirrors `coordinatorCondition` (coordinator-condition-keys.ts:53): `conditionKey` is the
 *  store's durable identity for dedup/resolve-suppression (supervisor-store.ts createEscalation),
 *  and `conditionTuple` is the same element list fed to the store's own `hashTuple`.
 *
 *  Do NOT derive the key via `conditionIdentity(kind, subject)` (supervisor-store.ts:755) —
 *  that collapses to `${kind}:${subject[0]}`, so every `blocker`-kind site would cross-
 *  suppress unrelated cards. The discriminator lives in the key string itself. */

export type LeafExecutorConditionReason =
  | 'security-violation'
  | 'optimistic-merge-revert-failed'
  | 'park-blocked'
  | 'node-could-not-start'
  | 'epic-base-red'
  | 'scope-incident'
  | 'empty-diff-declared-changes';

export const LEAF_EXECUTOR_CONDITION_REASONS: Readonly<Record<string, LeafExecutorConditionReason>> =
  Object.freeze({
    securityViolation: 'security-violation',
    optimisticMergeRevertFailed: 'optimistic-merge-revert-failed',
    parkBlocked: 'park-blocked',
    nodeCouldNotStart: 'node-could-not-start',
    epicBaseRed: 'epic-base-red',
    scopeIncident: 'scope-incident',
    emptyDiffDeclaredChanges: 'empty-diff-declared-changes',
  });

/** Build `{ conditionKey, conditionTuple }` from a `kind` plus its ordered discriminator
 *  parts. `conditionKey = [kind, ...parts].join(':')`; `conditionTuple = [kind, ...parts]`
 *  (same element list — the store's `hashTuple` is order-insensitive, so element identity,
 *  not join order, is what matters). */
export function leafExecutorCondition(
  kind: string,
  ...parts: string[]
): { conditionKey: string; conditionTuple: string[] } {
  const conditionTuple = [kind, ...parts];
  return { conditionKey: conditionTuple.join(':'), conditionTuple };
}

/** Reduce a free-form `parkBlocked` reason to its stable leading class token: the substring
 *  before the first ':' or newline (whichever comes first), trimmed and lowercased. Empty or
 *  whitespace input returns 'unknown' so the key never ends in a bare separator.
 *
 *  Live reason shapes it must collapse:
 *  - `optimistic-merge-revert-failed: <finding>` → `optimistic-merge-revert-failed`
 *  - `epic-base-red: <cmd>\n--- output (tail) ---\n…` → `epic-base-red`
 *  - `discarded-not-owned: …` → `discarded-not-owned`
 *  - `empty-diff-spec-demands-changes` (no separator) → itself */
export function leafParkReasonClass(reason: string): string {
  if (!reason || !reason.trim()) {
    return 'unknown';
  }

  // Find the first ':' or newline, whichever comes first
  const colonIdx = reason.indexOf(':');
  const newlineIdx = reason.indexOf('\n');

  let cutAt = -1;
  if (colonIdx !== -1 && newlineIdx !== -1) {
    cutAt = Math.min(colonIdx, newlineIdx);
  } else if (colonIdx !== -1) {
    cutAt = colonIdx;
  } else if (newlineIdx !== -1) {
    cutAt = newlineIdx;
  }

  const prefix = cutAt !== -1 ? reason.substring(0, cutAt) : reason;
  return prefix.trim().toLowerCase();
}
