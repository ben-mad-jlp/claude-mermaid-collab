/** Condition keys for the coordinator-live raise sites (14 `createEscalation` call sites).
 *
 *  Mirrors `infraRejectedConditionKey` (conductor-infra-arm.ts:114) and
 *  `depStrandConditionKey` (reconcile-pass.ts:68): `conditionKey` is the store's durable
 *  identity for dedup/resolve-suppression (supervisor-store.ts createEscalation), and
 *  `conditionTuple` is the same element list fed to the store's own `hashTuple`.
 *
 *  Do NOT derive the key via `conditionIdentity(kind, subject)` (supervisor-store.ts:755) —
 *  that collapses to `${kind}:${subject[0]}`, so every `blocker`-kind site would cross-
 *  suppress unrelated cards. The discriminator lives in the key string itself. */

export type CoordinatorConditionReason =
  | 'daily-budget'
  | 'stranded-accept-reversed'
  | 'parked-held-reopen-cap'
  | 'redispatch-cap'
  | 'bp1-stranded-foundation'
  | 'merge-back-conflict'
  | 'merge-back-failed'
  | 'leaf-executor-error'
  | 'no-worker-lane'
  | 'retry-exhausted'
  | 'budget-hard-cap'
  | 'rate-cap-exhausted'
  | 'gate-rejected';

/** `BP0_STRANDED_SUMMARY_KIND` reused as a literal here (coordinator-live.ts:1142) since the
 *  bp0 summary site's `kind` IS the discriminator (no reason-class part). */
export const BP0_STRANDED_SUMMARY_REASON = 'bp0-stranded-summary' as const;

export const COORDINATOR_CONDITION_REASONS: Readonly<Record<string, CoordinatorConditionReason>> = Object.freeze({
  dailyBudget: 'daily-budget',
  strandedAcceptReversed: 'stranded-accept-reversed',
  parkedHeldReopenCap: 'parked-held-reopen-cap',
  redispatchCap: 'redispatch-cap',
  bp1StrandedFoundation: 'bp1-stranded-foundation',
  mergeBackConflict: 'merge-back-conflict',
  mergeBackFailed: 'merge-back-failed',
  leafExecutorError: 'leaf-executor-error',
  noWorkerLane: 'no-worker-lane',
  retryExhausted: 'retry-exhausted',
  budgetHardCap: 'budget-hard-cap',
  rateCapExhausted: 'rate-cap-exhausted',
  gateRejected: 'gate-rejected',
});

/** Build `{ conditionKey, conditionTuple }` from a `kind` plus its ordered discriminator
 *  parts. `conditionKey = [kind, ...parts].join(':')`; `conditionTuple = [kind, ...parts]`
 *  (same element list — the store's `hashTuple` is order-insensitive, so element identity,
 *  not join order, is what matters). */
export function coordinatorCondition(
  kind: string,
  ...parts: string[]
): { conditionKey: string; conditionTuple: string[] } {
  const conditionTuple = [kind, ...parts];
  return { conditionKey: conditionTuple.join(':'), conditionTuple };
}
