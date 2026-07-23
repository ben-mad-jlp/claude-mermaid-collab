/**
 * harness-caps — the single place to see every loop-breaker cap and worker-liveness
 * threshold in the harness. Each of these was added independently, over time, to patch
 * one specific incident (a retry loop, a stranded reclaim, a false-dead worker) — with
 * no shared surface, so the same "retry/serve cap ≈ 3" shape got reinvented six times
 * and "is this worker dead" got answered four different ways. This module does not
 * change any of that: it is a behavior-preserving consolidation. Same names (or
 * re-exported from their original module), same defaults, same env-var overrides,
 * same read timing.
 *
 * New loop-breaker caps or liveness thresholds go HERE, not back out into the modules
 * that consume them.
 */

// ── Loop-breaker caps ────────────────────────────────────────────────────────────

/** After this many serving epics have been filed for ONE criterion and it is STILL
 *  unmet (a fresh 'discover'), stop re-filing and escalate to a human once. A criterion
 *  whose satisfaction structurally needs a HUMAN action (a live measurement, a deploy,
 *  a rescope) the headless daemon cannot do otherwise makes the conductor file a new
 *  serving epic every tick — the overnight thrash this cap kills.
 *  Origin: src/services/mission-store.ts (deriveCriterionAction). */
export const CRITERION_SERVE_CAP = 3;

/** How many times a FAILED conductor serve (node/planner failure) retries the SAME
 *  mission state across ticks before the pass stops respinning an expensive node on it.
 *  Bounds the retry so a transient failure self-heals but a persistently-unservable
 *  state does not thrash forever.
 *  Origin: src/services/conductor-pass.ts (runConductorPass fail-retry counter). */
export const CONDUCTOR_SERVE_RETRY_CAP = 3;

/** HARD RE-DISPATCH CAP (loop breaker). A todo re-dispatched this many times without
 *  reaching done/accepted is looping — each dispatch re-runs (and re-pays) a full
 *  blueprint. Past the cap the daemon PARKS it held + escalates instead of paying
 *  another blueprint. The counter is retryCount, which launchWorker bumps on EVERY
 *  dispatch (releaseExpiredClaims only bumps on lease expiry, so the clean-release
 *  escalation path was previously invisible to the cap — the observed opus-blueprint
 *  burn). reset_todo clears retryCount, so a human/conductor can grant a fresh attempt
 *  once the root cause is fixed. Override with MERMAID_MAX_REDISPATCH (default 3).
 *  Origin: src/services/coordinator-live.ts. */
export const MAX_REDISPATCH = Math.max(1, Number(process.env.MERMAID_MAX_REDISPATCH) || 3);

/** DURABLE PER-LEAF CEILING on epic-base-moved retry REFUNDS (loop breaker for the
 *  cap-neutrality hole). The epic-base-moved park refunds the dispatch-time retryCount
 *  bump because the run did zero real work. But when the trunk gate stays red, EVERY
 *  re-dispatch bumps retryCount and the base-moved park refunds it right back — netting
 *  to zero forever, so MAX_REDISPATCH never engages and the leaf loops indefinitely.
 *  Past this many refunds the refund STOPS (a durable per-leaf counter, todos.
 *  baseMovedRefunds, records them), so retryCount climbs to MAX_REDISPATCH and
 *  parkRedispatchCap retires the leaf instead. reset_todo clears retryCount, so a
 *  human/conductor can still grant a fresh attempt. Override with
 *  MERMAID_MAX_BASE_MOVED_REFUNDS (default 3).
 *  Origin: src/services/leaf-executor.ts (parkBlocked 'epic-base-moved'). */
export const MAX_BASE_MOVED_REFUNDS = Math.max(1, Number(process.env.MERMAID_MAX_BASE_MOVED_REFUNDS) || 3);

/** OI-1 loop-bound: cap stranded-accept reopens. reopenStrandedAccept re-surfaces an
 *  un-integratable leaf as `ready` so a worker re-does it. But if the LAND itself is
 *  structurally stuck (e.g. the work was salvaged to the integration branch
 *  out-of-band, so the leaf's OWN commit can never become an ancestor; or the epic→
 *  integration land keeps conflicting), re-doing produces another commit that ALSO
 *  won't integrate — an infinite re-claim/re-build loop that burns the model budget
 *  forever (observed live: build123d A1 "dump_plan core" looped ~5h at `drive`). Bound
 *  it: after N reopens for the same leaf, stop re-surfacing and PARK it held +
 *  escalate, exactly like the lease-retry-exhaust path, so a human integrates it once
 *  instead of the daemon rebuilding it endlessly.
 *  Origin: src/services/coordinator-live.ts. */
export const STRANDED_REOPEN_CAP = Number(process.env.MERMAID_STRANDED_REOPEN_CAP) || 3;

/** After this many LANDS re-open the same mission criterion's evidence, raise an
 *  operator-visible churn card — the criterion's evidencePaths pin may be too broad
 *  (matching unrelated lands) and keeps un-verifying it.
 *  Origin: src/services/mission-store.ts (unverifyCriteriaForLandedPaths /
 *  raiseReopenChurnCard). */
export const REOPEN_CARD_THRESHOLD = 5;

/** Threshold of consecutive identical red land-proof reasons (same reconcile tick
 *  derivation, unchanged) before the daemon auto-land path surfaces an operator card —
 *  "the daemon has retried N times without progress; a human should look."
 *  Origin: src/services/coordinator-live.ts (surfaceStuckAutoLand / stuckAutoLandCounters). */
export const STUCK_AUTOLAND_THRESHOLD = 3;

/** Closes the create_epic → add_leaves window where a freshly-filed serving epic has
 *  zero leaf children yet and would otherwise derive servingEpicLive = false →
 *  criterion action 'discover' → a duplicate serving epic filed by the conductor before
 *  the first epic's leaves land. Epics within this grace window after createdAt count as
 *  live even with no child leaves or ledger motion yet. Override with
 *  MERMAID_CHILDLESS_SERVE_GRACE_MIN.
 *  Origin: src/services/mission-store.ts (collectMissionStatusFacts). */
export const CHILDLESS_SERVE_GRACE_MS =
  (Number(process.env.MERMAID_CHILDLESS_SERVE_GRACE_MIN) || 5) * 60 * 1000;

/** ENFORCED ceiling on blueprint output tokens. Observed from 37 blueprints in live runs:
 *  average 17,175 / max 61,655 output tokens. A blueprint node whose output (token count)
 *  exceeds this ceiling triggers exactly one bounded re-emit via buildBlueprintSummarizePrompt,
 *  not a silent pass-through. The re-emit asks the node to trim the prose while preserving
 *  every criterion, file, and task. Override with MERMAID_BLUEPRINT_OUTPUT_CAP. */
export const BLUEPRINT_OUTPUT_TOKEN_CAP =
  Math.max(1000, Number(process.env.MERMAID_BLUEPRINT_OUTPUT_CAP) || 20000);

// ── Worker-liveness thresholds ───────────────────────────────────────────────────

/** How long since a lane's last DURABLE session_status pulse (updatedAt) before that
 *  pulse counts as stale. Paired with a not-alive confirmation for the two-fact
 *  reclaim (shouldPulseReap); ~8s collapses the orphan-detection latency from the
 *  15-min/​~9h grace to seconds. Override with MERMAID_PULSE_STALE_MS.
 *  Origin: src/services/coordinator-core.ts. */
export const DEFAULT_PULSE_STALE_MS = Number(process.env.MERMAID_PULSE_STALE_MS) || 8_000;

/** How long a LEAF may sit in_progress with no live claim before the orphan reaper
 *  reclaims it. Distinct from the 40-min claim lease: the lease only fires when
 *  claimedAt+claimLeaseMs are set, but an orphan's defining trait is that they are NULL
 *  (e.g. wiped by a daemon restart). 15 min by default — long enough to clear a
 *  spawn/handoff gap, short enough that a stuck leaf doesn't sit for hours (the
 *  19b097a1 ~9h gap). Override with MERMAID_ORPHAN_GRACE_MIN.
 *  Origin: src/services/coordinator-core.ts. */
export const DEFAULT_ORPHAN_GRACE_MS =
  (Number(process.env.MERMAID_ORPHAN_GRACE_MIN) || 15) * 60 * 1000;

/** Claim lease before a worker's todo is reclaimable. 40 min by default — big
 *  multi-component todos (e.g. a UI command-center build) exceed a short lease and get
 *  falsely reclaimed mid-work. Override with MERMAID_CLAIM_LEASE_MIN.
 *  Origin: src/services/coordinator-daemon.ts. */
export const DEFAULT_LEASE_MS =
  (Number(process.env.MERMAID_CLAIM_LEASE_MIN) || 40) * 60 * 1000;

/** Landed-epic leftover grace window / stuck threshold (ms), for the
 *  'landed-needs-review' arm of sweepEpicRollups. A non-done or done-but-unaccepted
 *  child of an optimistically-landed epic whose updatedAt is within this window is
 *  treated as actively building — held, not flagged. Idle PAST the window = stuck →
 *  flag (mirrors the motionless arm's idle threshold; one boundary serves as both
 *  the grace window and the stuck threshold).
 *
 *  A LIVE CLAIM always counts as active regardless of this window — and the claim
 *  model (de-conflate S1: in_progress ≡ claim != null) means a genuinely building
 *  child ALWAYS holds one, so the claim signal alone excludes the healthy case.
 *  An in_progress row WITHOUT a claim is an orphan (daemon restart / reap) and is
 *  stuck on sight. Default 0: only the claim signal excludes — behavior changes
 *  ONLY in the pathological actively-building-flagged case, never for genuinely
 *  stuck leftovers. Override with MERMAID_LANDED_GRACE_MIN (minutes).
 *  Origin: src/services/todo-store.ts (sweepEpicRollups). */
export const LANDED_LEFTOVER_GRACE_MS =
  (Number(process.env.MERMAID_LANDED_GRACE_MIN) || 0) * 60 * 1000;
