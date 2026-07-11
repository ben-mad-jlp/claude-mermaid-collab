# Todo model — iterative-design-tax investigation

Status: DISCUSSION / not-yet-actioned. Triggered by: "why do we materialize blocked→ready
via the daemon when readiness is derivable from the graph? Maybe we're paying the iterative
design tax and todo needs a refactor."

## Ground truth (code audit)

`Todo` (src/services/todo-store.ts:27-86) has grown to **29 fields across ~10 concern layers**:
checklist (a) · work-graph status/parentId/dependsOn (b) · daemon claim/lease — 4 fields with a
fragile "all-4 non-null IFF in_progress" invariant (c) · acceptance/gate (d) · blueprint link (e) ·
multi-repo execution: type/targetProject/assignee/executedBy/asanaGid (f) · decision+probe gates (g) ·
durable-object firewall objectRef (h).

8-value `status` enum read in **40+ places** (daemon, gates, invariant-check, ~30 UI sites).

**The core conflation (confirmed):** `status` stores BOTH a *derivable* fact (dependency-readiness =
`dependsOn.every(d => d.status==='done' && d.acceptanceStatus!=='rejected')`, todo-store.ts:787) AND a
*non-derivable* decision (only the Planner promotes planned→ready via supervisor-routes.ts:192; the
daemon never self-promotes). Readiness is materialized (completeTodo unblock fan-out flips blocked→ready,
:833-846) AND recomputed at claim time (listReadyTodos, :650-658). The stored value isn't trusted.

**Known pain (operational, not theoretical):**
- Todos strand in `blocked` if the unblock fan-out misses → a sweep/reconcile pass exists to catch it.
- `blocked-by-rejected-dep` is indistinguishable from `blocked-by-open-dep`; rejected → no auto-recovery.
- The 4-field claim invariant caused a ~9h "invisible in_progress" stranding bug (one path missed clearing it).
- `done` is reachable 3 ways (agent gate / human completion / decision-gate auto-complete); UI must read
  acceptanceStatus + completedBy + decisionRef alongside status to know what actually happened.

## Grok consult (skeptical-reviewer framing) — synthesis

Grok: conflation is REAL, the bugs are the proof, not gold-plating. Risk rank: (1) claim-invariant
stranding [highest], (2) ambiguous blocked / rejected-dep no-recovery [high], (3) 3-paths-to-done tax
[med], (4) reconciliation-as-mechanism smell [med-low], (5) perf/40-readers/auditability [LOW at this
scale — discount]. "Derive readiness, don't store it" is correct here; materialized status earns
*negative* keep (fan-out bugs + reconcile + invariant + UI reverse-engineering).

**Our synthesis (ACCEPT / TEMPER / DISCOUNT against local-first single-user context):**
- ACCEPT: split the derived half out of `status`. Store only the decision (`approved`/`held`); derive
  `claimable = approved && depsSatisfied && !held` via ONE shared predicate both daemon + UI import.
- ACCEPT: collapse the 4 claim fields into a single nullable `claim` struct — kills the invariant class
  of bug at the model level instead of with comments + 5 hand-synced clear sites.
- ACCEPT: stop the blocked→ready fan-out; keep the sweep only as a transitional safety net.
- ACCEPT: handle rejected deps explicitly in the predicate (already have the logic), and decide what
  `blocked` MEANS once fan-out is gone (probably → a `held` flag for manual-only blocks).
- TEMPER: the "god table" split (separate claim/acceptance/lease into their own tables) — Grok flags it
  as the real disease. Agree, but do it AFTER the status/predicate fix, not in the same change. At this
  scale a wide SQLite row is cheap; the cost is cognitive, so stage it.
- TEMPER/replace the lost event-edge: today "status→ready" wakes the daemon (orchestrator-kick seam).
  If readiness is derived, emit the kick on the two INPUT events instead (dep went terminal + approval
  set), with the interval scan as backstop. NO message bus.
- DISCOUNT: anything distributed (event sourcing / CQRS / bus). Single-user SQLite.

**Predicate-drift is the #1 second-order risk:** one exported `isClaimable(todo, byId)` module, imported
by daemon AND UI; never reimplemented. If SQL counts need it later, one view/helper, not a second copy.

## Minimal-refactor sketch (what kills the most pain, avoids the rewrite)
1. Add `approved` (bool/`approvedAt`) — the human gate. Migrate existing ready/planned rows once.
2. Add nullable `claim` struct; retire the 4 loose claim fields.
3. One `isClaimable()` predicate; daemon + UI both route through it.
4. Remove the blocked→ready fan-out; sweep becomes safety net only.
5. Rejected dep → `depsSatisfied=false` until fixed/unlinked (explicit in predicate).
Leave the 8-value enum in place; migrate readers incrementally (daemon first, then UI). No big-bang.

## Next step
Candidate for the `design-exploration` skill (diverge→judge→synthesize) to produce the actual target
model + staged migration plan before any code. NOT started — discussion only.
