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
 *  Consumed by TWO call sites at the SAME `>= CRITERION_SERVE_CAP` comparison:
 *  criterion-approach-store.ts (ladderExhausted's serve-cap backstop) and
 *  mission-store.ts (deriveCriterionAction's escalate check). These must never diverge —
 *  a criterion must never read 'escalate' while the ladder reads not-exhausted.
 *  Origin: src/services/mission-store.ts (deriveCriterionAction). */
export const CRITERION_SERVE_CAP = 3;

/** Panel review starts before the serve cap escalates. When a criterion approaches
 *  CRITERION_SERVE_CAP, the verify process requests a high-stakes panel (multiple
 *  independent checkers) to raise confidence on the prior evidence before the
 *  criterion hands off to a human for manual intervention. This threshold must remain
 *  strictly < CRITERION_SERVE_CAP, so the panel convenes at serve-burn and has time
 *  to run before deriveCriterionAction escalates.
 *  Origin: src/services/criterion-verify-stakes.ts (classifyVerifyStakes). */
export const CRITERION_PANEL_SERVE_THRESHOLD = 2;

/** Threshold of rejected + blocked leaves in an epic before it is diagnosed as churning
 *  (producing rejection loops). An epic with >= this many rejections+blocks AND zero
 *  accepted leaves indicates the epic's decomposition is wrong and needs re-scoping.
 *  Origin: src/services/epic-churn.ts (detectEpicChurn). */
export const EPIC_CHURN_REJECT_THRESHOLD = 2;

/** How many times a FAILED conductor serve (node/planner failure) retries the SAME
 *  mission state across ticks before the pass stops respinning an expensive node on it.
 *  Bounds the retry so a transient failure self-heals but a persistently-unservable
 *  state does not thrash forever.
 *  Origin: src/services/conductor-pass.ts (runConductorPass fail-retry counter). */
export const CONDUCTOR_SERVE_RETRY_CAP = 3;

/** How many CONSECUTIVE EMPTY CONDUCTS the conductor may spend on ONE unchanged serve-state
 *  before it stops re-arming and cards a human once.
 *
 *  An EMPTY CONDUCT is a pass that RAN a conductor node (ran=1, outcome 'conducted') and filed
 *  NOTHING and carried NOTHING. Such a pass is no longer allowed to become the debounce anchor
 *  (see latestProductivePassFp) — otherwise the world fingerprint never moves, the conductor is
 *  the only actor that could move it, and the mission is locked forever (mission 949dda42,
 *  2026-08-14: 253s of Opus, 15.9k output tokens, filed nothing, then every pass for 10 minutes
 *  returned 'debounced' with three criteria still at `discover`).
 *
 *  Un-anchoring ALONE would re-spin a ~4-minute Opus node every 30s forever — exactly the
 *  unbounded self-excitation the rolled-back-gap comment in conductor-pass.ts warns about
 *  (2026-07-23: "expected 1 node, got 20"). So the re-arm is BOUNDED here: 2 consecutive empty
 *  conducts on the same serveFp is enough to prove "the node saw this state and had nothing" —
 *  one to observe it, one to confirm it was not a one-off — after which the pass stops re-arming
 *  and raises exactly one deduped card. A productive pass, or any change to serveFp, resets the
 *  run to 0. Override with CONDUCTOR_EMPTY_CONDUCT_CAP (default 2).
 *  Origin: src/services/conductor-pass.ts (runConductorPassInner empty-conduct guard). */
export const CONDUCTOR_EMPTY_CONDUCT_CAP = Math.max(1, Number(process.env.CONDUCTOR_EMPTY_CONDUCT_CAP) || 2);

/** How many attempts a carded leaf may accumulate before the card-triage arm parks it
 *  deterministically instead of letting the conductor re-dispatch it again. Replaces the
 *  same `attempts >= 3` threshold previously spelled out in the conductor's own prompt
 *  (a prohibition in a prompt is not a constraint) — the check now lives in code.
 *  Origin: src/services/conductor-card-triage-arm.ts. */
export const CARD_TRIAGE_PARK_ATTEMPTS = 3;

/** How many conductor beats a driven mission may go without a new pass stamp
 *  (lastConductorPassAt) before its progress clock is treated as stale. Retained as a
 *  shared cap for the conductor progress-clock diagnostics. */
export const CONDUCTOR_LEADER_STALE_TICKS = 4;

/** The conductor heartbeat period, so the stale-leader bound above is expressed in
 *  beats rather than a second hardcoded millisecond literal.
 *  Origin: src/services/orchestrator-live.ts (CONDUCTOR_INTERVAL_MS). */
export const CONDUCTOR_BEAT_MS = 30_000;

/** Wall-clock ceiling for ONE conductor NODE invocation.
 *
 *  Before this constant existed the conductor invoke passed no `timeoutMs` and silently
 *  inherited node-invoker's DEFAULT_TIMEOUT_MS (600_000) — a generic per-node default never
 *  sized against what a conductor pass actually costs. Measured over 14 days of production
 *  conductor runs (worker_ledger, source='conductor', n=874):
 *
 *    <1m 242 · 1–5m 406 · 5–9.9m 142 · 600–610s 75 (0 steps, 0 tokens, $0.00) · >10m 9
 *
 *  i.e. 142 PRODUCTIVE passes already ran 5–9.9 minutes — 16% of real work sitting in the
 *  last 40% of the budget — while 75 passes (8.6% of all passes, across 37 distinct missions)
 *  were killed at the wall having produced nothing. The old ceiling was not catching a rare
 *  pathology; it was amputating the workload's natural right tail.
 *
 *  20 minutes clears the observed productive tail with headroom. It is deliberately NOT a
 *  substitute for bounding the retry: a pass that keeps hitting even this ceiling is a fact
 *  about that serve-state (its evidence payload cannot be processed in budget), not bad luck,
 *  and must be bounded + carded separately — see bugs ce7f74bf / 565f7bef. Raising a ceiling
 *  only moves a wall.
 *
 *  START_WINDOW_MS (60s, node-invoker.ts) is unaffected: a node that never emits stdout still
 *  dies in ~a minute, so this does NOT slow the spawn-wedge path.
 *  Origin: src/services/conductor-pass.ts (the invokeNode call in runConductorPassInner). */
export const CONDUCTOR_NODE_TIMEOUT_MS = 1_200_000;

/** Counts CONSECUTIVE `timedOut` conductor node invocations on ONE unchanged serve-state
 *  (keyed `${serveFp}|timeout:N`). This is a DISTINCT counter from CONDUCTOR_SERVE_RETRY_CAP
 *  (node FAILURE) and never reuses that identifier or its stored key — a timeout is an infra
 *  fact about the serve-state's cost (its evidence payload cannot be processed inside
 *  CONDUCTOR_NODE_TIMEOUT_MS), not a productive-attempt failure. Override with
 *  CONDUCTOR_TIMEOUT_RECUR_CAP (default 3). */
export const CONDUCTOR_TIMEOUT_RECUR_CAP = Math.max(1, Number(process.env.CONDUCTOR_TIMEOUT_RECUR_CAP) || 3);

/** Cap on `runPanel` invocations per `runVerifyPanelArm` pass — bounds how many
 *  independent-checker panel runs one verify-panel arm may spend in a single conductor
 *  pass, so a criterion with many pending verifications can't burn an unbounded number
 *  of panel runs in one tick.
 *  Origin: src/services/conductor-verify-panel-arm.ts. */
export const CONDUCTOR_VERIFY_BATCH_MAX = 5;

/** The serve-side twin of CONDUCTOR_VERIFY_BATCH_MAX: the cap on how many `discover`
 *  gaps get enumerated into the conductor node prompt/wake-context slate in one pass.
 *  Same default value as CONDUCTOR_VERIFY_BATCH_MAX by design, not coincidence — both
 *  bound the size of one pass's unit of work the same way.
 *  Origin: src/services/conductor-wake-context.ts. */
export const CONDUCTOR_SERVE_BATCH_MAX = 5;

/** Durable per-criterion ceiling on individual verify-panel attempts, recorded on
 *  mission_criterion.verifyAttemptCount. Distinct from CRITERION_SERVE_CAP (above),
 *  which counts serving-epic filings, not verify-panel attempts.
 *  Override with CRITERION_VERIFY_ATTEMPT_CAP (default 3). */
export const CRITERION_VERIFY_ATTEMPT_CAP = Math.max(1, Number(process.env.CRITERION_VERIFY_ATTEMPT_CAP) || 3);

/** Durable per-criterion ceiling on individual serve-batch attempts, recorded on
 *  mission_criterion.serveAttemptCount. Distinct from CRITERION_SERVE_CAP (above),
 *  which counts serving-epic filings, not serve-batch attempts.
 *  Override with CRITERION_SERVE_ATTEMPT_CAP (default 3). */
export const CRITERION_SERVE_ATTEMPT_CAP = Math.max(1, Number(process.env.CRITERION_SERVE_ATTEMPT_CAP) || 3);

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

/** NO-SILENT-STOP grace: how long a mission may sit in a STALLED mission-loop reason
 *  (see mission-stall.ts's classification table — over-budget, no-nudge-target,
 *  blocked-silenced, an unhandled no-action:<status>) before the loop raises ONE
 *  human-visible card and the mission's derived status flips to 'stalled'.
 *
 *  Origin: mission a6ab522b (2026-07-24). Its spend crossed the $50 budget;
 *  planMissionLoopStep returned `{ kind: 'none', reason: 'over-budget' }` — no card, no
 *  nudge, no state change — and the mission sat DEAD for 1h45m while its UI badge still
 *  read "BUILDING". Nobody noticed until a human asked. A stall must cost at most this
 *  much wall-clock silence.
 *
 *  20 min ≈ 8 mission-loop passes (MISSION_LOOP_INTERVAL_MS = 2.5 min), long enough that a
 *  transient no-owner-session / session-restart blip self-heals without carding a human.
 *  Override with MERMAID_MISSION_STALL_GRACE_MIN. */
export const MISSION_STALL_GRACE_MS =
  (Number(process.env.MERMAID_MISSION_STALL_GRACE_MIN) || 20) * 60 * 1000;

/** VERIFY-OWED backstop: how long a criterion may have a landing, completed serving work,
 *  and an awaiting-verify action without a new verify gate running before the mission-loop
 *  raises a human card. When a serving epic LANDS (the proof is in and stable), verify is
 *  owed immediately — but if no in-flight conductor node or lease is holding the criterion
 *  open (all of awaitingVerify/verifyInFlight are zero), the verification is stalled without
 *  an actor. This threshold bounds that silent drift: past it, the mission is dead-locked
 *  and a human must either approve the verdict or re-open the epic.
 *
 *  Must be strictly shorter than MISSION_STALL_GRACE_MS (the latter decides overall mission
 *  stall; this is one contributor to it) and strictly longer than CONDUCTOR_BEAT_MS so
 *  a transient conductor skip does not immediately fire.
 *
 *  10 min clears a typical conductor tick (30s) + buffer, leaving idle detect to
 *  conductor-pass.ts:1076 debounce (returns above verify arm at :1200). This avoids both
 *  a false alarm on conductor hiccup and unbounded drift when the conductor is genuinely
 *  blocked elsewhere.
 *
 *  Override with MERMAID_VERIFY_OWED_MIN (default 10 minutes).
 *  Origin: src/services/mission-stall-predicate.ts (isVerifyOwedPastThreshold predicate). */
export const VERIFY_OWED_BACKSTOP_MS =
  (Number(process.env.MERMAID_VERIFY_OWED_MIN) || 10) * 60 * 1000;

/** TTL on the in-memory stall episode that backs the 'stalled' derived status. The stall
 *  clock is fed by the mission-loop pass; if the pass STOPS running for a project (project
 *  unwatched, daemon off, process churn) a stale episode would otherwise pin a mission at
 *  'stalled' forever with nothing left to clear it. An episode not re-observed within this
 *  window is treated as absent, so the flag self-heals instead of latching.
 *  Origin: src/services/mission-stall.ts (isMissionStalled). */
export const MISSION_STALL_FLAG_TTL_MS =
  (Number(process.env.MERMAID_MISSION_STALL_TTL_MIN) || 30) * 60 * 1000;

/** ENFORCED ceiling on blueprint output tokens — a RUNAWAY guard, not a quality gate. A
 *  blueprint node whose output exceeds this ceiling triggers exactly one bounded re-emit via
 *  buildBlueprintSummarizePrompt (trim prose, preserve every criterion/file/task), not a silent
 *  pass-through. Override with MERMAID_BLUEPRINT_OUTPUT_CAP.
 *
 *  Raised 20k → 40k (2026-07-29) from a worker-ledger correlation of blueprint size vs terminal
 *  outcome (max single-blueprint outputTokens per leaf, bucketed):
 *    <10k 86.2% acc (1.33 bp-nodes) · 10-20k 86.0% (1.33) · 20-30k 81.7% (2.42) ·
 *    30-40k 80.0% (2.65) · 40-60k 66.7% (2.33, n=12) · 60k+ 100% (n=1).
 *  Accept rate is FLAT to ~40k, so size does NOT predict rejection below it — the old 20k cap
 *  (≈1.2× the 17k average) fired on the normal upper tail of hard leaves, ~DOUBLING the blueprint
 *  node count (1.33 → 2.4+) for a full re-emit re-pay with NO accept-rate benefit, while the
 *  blueprint is cheap cached-reads downstream. 40k eliminates that tax on the 20-40k band and
 *  keeps a guard above 40k, where the only (small-sample) quality dip and true-runaway risk sit. */
export const BLUEPRINT_OUTPUT_TOKEN_CAP =
  Math.max(1000, Number(process.env.MERMAID_BLUEPRINT_OUTPUT_CAP) || 40000);

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
