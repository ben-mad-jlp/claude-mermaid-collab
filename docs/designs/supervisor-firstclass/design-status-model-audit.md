# Todo / Work-Graph Status Model Audit

**Trigger:** the Bridge funnel counted ~31 "done" todos as In-flight, because the in-flight predicate keys off `!!claimedBy` and `completeTodo` never clears `claimedBy`/`claimToken` on done. Status and claim contradict.

**DB sample (`./.collab/todos.db`, 88 todos):** confirmed the bug at scale —
- `done` = 80; **`done` WITH `claimedBy` still set = 32** (and `claimToken` set = 32 — same rows, the coordinator-completed ones).
- `nondone_with_claimedBy` = 32 (all are the done rows; 0 in `blocked`/`ready` carry a claim).
- `completedAt` is **perfectly consistent** with `status='done'`: 0 done-without-completedAt, 0 not-done-with-completedAt.
- `acceptanceStatus`: null=41, accepted=47, **pending=0, rejected=0**. All accepted are also `done`. No rejected todos exist, so the rejected-path code is entirely untested by live data.

---

## 1. The model + status-lifecycle fields

Source of truth: `src/services/todo-store.ts` (the `Todo` type, lines 19-47). UI mirror: `ui/src/types/sessionTodo.ts`.

| Field | Type | Intended meaning | Axis |
|---|---|---|---|
| `status` | `backlog\|planned\|todo\|ready\|in_progress\|blocked\|done\|dropped` | Pipeline position. `backlog/planned/todo`=not-approved; `ready`=approved + deps done, claimable; `in_progress`=claimed; `blocked`=approved-but-deps-pending **OR** retry-exhausted; `done`/`dropped`=terminal | **Pipeline** |
| `claimedBy` | `string\|null` | Session holding the lease (`coordinator` / worker session) | Claim |
| `claimToken` | `string\|null` | Per-claim nonce; `claimTodo` requires `claimToken IS NULL` to claim | Claim |
| `claimedAt` | `string\|null` | Lease start; `claimedAt + claimLeaseMs` = expiry | Claim |
| `claimLeaseMs` | `number\|null` | Lease duration | Claim |
| `retryCount` | `number` | Lease-expiry / dead-claim reclaim count; cap = `MAX_CLAIM_RETRIES` (4) → park `blocked` | Claim |
| `acceptanceStatus` | `pending\|accepted\|rejected\|null` | Quality verdict; gates dep propagation (`depSatisfied`: done AND not rejected) | **Quality** |
| `completed` | `boolean` | **Derived** `status==='done'` (`rowToTodo` line 212). Not a stored column | Completion (redundant) |
| `completedAt` | `string\|null` | Timestamp; set when status→done, cleared otherwise | Completion |

Note: the task's suspected `previousAssigneeSession` is NOT a stored field — it's a transient returned only by `assignSessionTodo` (session-todos.ts:369). No drift risk.

**Four overlapping axes, confirmed:** Pipeline (`status`), Claim (5 fields), Quality (`acceptanceStatus`), Completion (`completed`+`completedAt`). Completion fully overlaps Pipeline's `done`. Claim should be a strict subset of `status==='in_progress'` but isn't enforced.

---

## 2. Write-site map

| Site | Transition | status | claim fields | completed/At | acceptanceStatus | Gap |
|---|---|---|---|---|---|---|
| `createTodo` (262) | new | =input or `todo` | null | At= ts if done | null | ok |
| `importTodo` (581) | import | =input or `todo` | null | At= ts if done | null | ok |
| `updateTodo` (288) | any edit | patch or derive from `completed` bool | **untouched** | At recomputed from status | patch only | **Sets status freely (incl. away from in_progress) but never clears claim fields** |
| `claimTodo` (344) | ready→in_progress | `in_progress` | **sets** all (token, by, at, lease) | — | — | ok (guarded by `status='ready' AND claimToken IS NULL`) |
| `completeTodo` (487) | →done | `done` | **NOT cleared** | At=COALESCE(existing,ts) | =arg or existing | **THE BUG: leaves claimedBy/claimToken/claimedAt/claimLeaseMs** |
| `completeTodo` unblock pass (503) | blocked→ready | `ready` | (deps, untouched) | — | — | ok |
| `completeTodo` roll-up (517) | parent→done | `done` | **NOT cleared** | At set | forced `accepted` | parent inherits same stale-claim bug if it was ever claimed |
| `releaseExpiredClaims` (375) | in_progress→ready/blocked | `ready`/`blocked` | **clears all** + retryCount++ | — | — | **Correct reference impl — clears claim on exit** |
| `reclaimClaim` (412) | in_progress→ready/blocked | `ready`/`blocked` | **clears all** + retryCount++ | — | — | ok |
| `completeTodosForTask` (session-todos.ts:357) | →done via updateTodo | `done` | **NOT cleared** (updateTodo path) | At set | — | same gap as updateTodo |
| supervisor-routes PATCH (128) | planner promote | =arg | untouched | — | — | promotes planned→ready; fine (no claim yet) |
| MCP `complete_todo` (setup.ts:4342) | →handleWorkerComplete→completeTodo | `done` | **NOT cleared** | — | =arg | inherits completeTodo bug |

**Core asymmetry:** `releaseExpiredClaims`/`reclaimClaim` clear claim fields on exit from `in_progress`; `completeTodo` (the most common exit) and `updateTodo` do **not**. The invariant "claim fields set ⟺ status==='in_progress'" is enforced on the reclaim paths but violated on the completion/edit paths.

---

## 3. Read / derive-site map

| Site | Keys off | Can disagree with `status`? |
|---|---|---|
| `funnel.ts isInflight` (26) | `in_progress \|\| (claimedBy && !done && !dropped)` | Guarded — explicitly excludes done/dropped to dodge the stale claim. **Defensive guard that only exists because of the bug** |
| `funnel.ts ready` (40) | `status==='ready' && !claimedBy` | ready never carries a claim in DB, but guards anyway |
| `liveness.ts currentTodoFor` (44-49) | `(claimedBy\|assignee)==session && (in_progress \|\| !!claimedBy)` | **BUGGY — no done guard.** A done todo with stale `claimedBy` is returned as the worker's "current todo" → phantom animated claim edge + wrong liveness in FleetGraph |
| `useFleetGraph` bucket/danger (153-169) | `bucketTodo` (funnel) + `claimedBy/assignee` for danger | inherits funnel guard; danger keys off claimedBy → stale claim can mis-flag danger |
| `useFleetGraph signature` (79) | includes `claimedBy` | stale claim churns the structural signature → unnecessary relayout when a todo completes |
| `roadmapToMermaid STATUS_CLASS` (8-17) | pure `status` | clean — never disagrees |
| `todoGrouping.ts` (36) | `status ?? (completed?'done':'todo')` | defensive fallback; completed derived so consistent |
| `TodosTreeSection` (61,74,183,188) | `status==='done' \|\| completed` | belt-and-suspenders on redundant `completed` |
| `TodoDetailView` (181), `ManagerDashboard` (49-50) | same `status ?? completed` pattern | defensive on `completed` |
| **server** `depSatisfied` (475) | `status==='done' && accept!=='rejected'` | the one true gate; reads acceptanceStatus |
| **server** `planCoordinatorTick` depsDone (20-23) | `status==='done'` **only — ignores rejected!** | **Divergence:** a rejected dep is `done` here → coordinator would claim a dependent that `depSatisfied` considers blocked |
| **server** `listReadyTodos` (429) | `status==='ready'` + `depSatisfied` | consistent with completeTodo |
| `reapDeadClaims` (coordinator-live 142) | `status==='in_progress'` | correct — done todos excluded, so stale claim doesn't get reaped here |

**`acceptanceStatus` is read in exactly ONE place — server `depSatisfied`.** No UI surface renders it. The "is done+rejected still done?" question never reaches a human via the UI.

---

## 4. Concrete ambiguities / inconsistencies

**(a) Claim fields not cleared on terminal/non-in_progress exit — THE primary bug.**
`completeTodo` (`todo-store.ts:495-497`) sets `status='done'` but omits the claim columns. `updateTodo` (288) and `completeTodosForTask` (session-todos.ts:357) have the same gap. **DB: 32/80 done todos carry stale `claimedBy`+`claimToken`.** Consumers that must defend: `funnel.ts:26`, and the one that *forgot* to defend: `liveness.ts:49`.

**(b) `completed` boolean — redundant but NOT drifting.** Derived (`rowToTodo:212`), never stored. `completedAt` 100% consistent in DB. It's dead weight, not a hazard: ~6 UI sites carry `status==='done' || completed` belt-and-suspenders code that could be deleted. Low value, low risk to remove from the read path; the boolean itself is harmless.

**(c) `acceptanceStatus` semantics — under-specified and invisible.** `done+rejected` stays `done` (completeTodo never reopens). `depSatisfied` then refuses to unblock dependents — so a rejected todo is a **silent terminal sink**: marked done, occupies a done bucket in every UI, but its dependents stay `blocked` forever with no surfaced reason (acceptanceStatus is never rendered). 0 rejected rows today, so this is untested in practice but is a latent trap the moment a worker reports `rejected`.

**(d) `blocked` is overloaded — two meanings, one value.** `releaseExpiredClaims`/`reclaimClaim` park retry-exhausted todos as `blocked` (needs-human); the unblock pass uses `blocked` for deps-pending (will auto-promote). The funnel/roadmap render both identically as danger. The only disambiguator is out-of-band: retry-exhausted ones get an escalation (`kind:blocker`) and have `retryCount > MAX_CLAIM_RETRIES`; deps-pending ones have unsatisfied `dependsOn`. No consumer can tell them apart from the todo alone — a human looking at a `blocked` node can't tell "waiting on a dep" from "gave up, fix me."

**(e) `planCoordinatorTick` vs `depSatisfied` divergence.** `coordinator-core.ts:20-23` treats any `done` dep as satisfied, ignoring `acceptanceStatus`. `todo-store.depSatisfied` (475) excludes rejected. In the live daemon the actual claim still goes through `claimTodo` (which only checks `status='ready'`), and promotion to ready is gated by the stricter `depSatisfied`, so this is currently masked — but it's a second, looser copy of the dep rule that will bite if `planCoordinatorTick` is ever used to drive promotion.

---

## 5. Scoped invariant-hardening refactor (phased)

**Guiding invariant:** *claim fields (`claimedBy`, `claimToken`, `claimedAt`, `claimLeaseMs`) are non-null **iff** `status==='in_progress'`.* Enforce at every write that leaves `in_progress`.

### Phase 1 — Fix the producer (highest value, lowest risk)
- **Change:** in `completeTodo` (todo-store.ts:495) add `claimedBy=NULL, claimToken=NULL, claimedAt=NULL, claimLeaseMs=NULL` to the done UPDATE (and the roll-up UPDATE at 524). In `updateTodo` (316), when the resolved `status !== 'in_progress'`, null the claim columns too.
- **Blast radius:** lets `funnel.ts:26` drop its `!done && !dropped` guard and `liveness.ts:49` becomes correct without change. Fixes the 32 mis-attributed rows once they're re-touched; add a one-shot backfill `UPDATE todos SET claimedBy=NULL,claimToken=NULL,claimedAt=NULL,claimLeaseMs=NULL WHERE status='done' AND claimedBy IS NOT NULL` (run in `openDb` migration block).
- **Risk:** very low. Nothing reads a done todo's claim fields intentionally. `reapDeadClaims` already filters to `in_progress`.

### Phase 2 — Clean the consumers (low value, do-while-you're-here)
- **Change:** drop the now-unneeded guard in `funnel.ts:26`; fix `liveness.ts:49` to `status==='in_progress'` only (not `|| !!claimedBy`). Optionally delete `status==='done' || completed` redundancy in the ~6 UI sites and standardize on `status==='done'`.
- **Blast radius:** removes defensive code; `completed`/`completedAt` can stay as a derived convenience (don't bother dropping the column — pure churn).
- **Risk:** low; covered by funnel/grouping tests.

### Phase 3 — Disambiguate `blocked` (medium value, only if a human-facing surface needs it)
- **Option A (cheap, recommended):** keep one `blocked` status but add a tiny derived helper `blockedReason(todo)`: `retryCount > MAX_CLAIM_RETRIES → 'needs-human'` else `'deps-pending'`. Render distinctly in the funnel/fleet (e.g. needs-human = loud, deps-pending = muted). No schema change.
- **Option B (over-engineering, skip):** split into `blocked`/`stuck` enum values — touches the type, every switch, every glyph map, the planner. Not worth it.
- **Risk:** A is low and additive.

### Phase 4 — Define the rejected path (medium value, latent)
- **Decision to make + encode:** does `rejected` reopen the todo or stay `done`? Recommendation: **`rejected` should NOT remain `done`** — `completeTodo(..., 'rejected')` should set `status='blocked'` (or `ready` for an immediate retry) instead of `done`, so it stops occupying a "done" bucket and surfaces as needing attention; keep `acceptanceStatus='rejected'` for the audit trail. Then `depSatisfied`'s rejected check becomes belt-and-suspenders rather than load-bearing.
- **Blast radius:** changes one branch in `completeTodo`; the rollup's forced `accepted` is fine. Surface `acceptanceStatus` somewhere (escalation already fires on non-accepted in coordinator-live:66).
- **Risk:** low today (0 rejected rows) but defines behavior before it's exercised. Worth doing before rejection is used in anger.

### Phase 5 — Reconcile the two dep rules (low value, hygiene)
- **Change:** make `planCoordinatorTick` (coordinator-core.ts:20) call the same satisfied predicate as `depSatisfied` (export it, share it), so the rejected exclusion is single-sourced.
- **Risk:** trivial; currently masked, so no behavior change today.

---

## 6. Verdict — how much refactor is warranted

**A small, focused fix — not a redesign.** The model's four axes are defensible; only ONE invariant is actually violated in production data (claim-not-cleared-on-exit), and it has exactly one real consumer bug (`liveness.ts`) plus one already-applied band-aid (`funnel.ts`).

- **Do now (Phase 1):** clear claim fields on every exit from `in_progress` in `completeTodo` + `updateTodo`, plus a one-shot backfill. This is the whole bug. ~10 lines + a migration.
- **Do alongside (Phase 2):** un-guard funnel, fix `liveness.ts`. ~5 lines.
- **Worth doing soon (Phase 4):** decide rejected→not-done before rejection is used. Cheap, prevents a silent dependents-stuck-forever trap.
- **Nice-to-have (Phase 3A, Phase 5):** derived `blockedReason`; single-source the dep predicate.
- **Skip / over-engineering:** splitting `blocked` into a new enum value; dropping the `completed` column/boolean (it's derived and non-drifting — leave it).

**First invariant to enforce:** *claim fields are non-null iff `status==='in_progress'`* — implemented as "null the four claim columns on any write that sets status to anything other than `in_progress`," starting in `completeTodo`.
