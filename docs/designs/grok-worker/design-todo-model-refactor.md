# Target Design: De-conflating the Todo Work-Graph Status

**Status:** Definitive design (lead data-model architect). Anchored on the winning concept **claim-struct-and-events**, with grafts per the judge verdict. Scope: local-first, single-user desktop app on SQLite. No distributed-systems machinery.

---

## VISION

Today `status` answers two unrelated questions with one column:
1. **"Are this todo's dependencies satisfied?"** — a *derivable fact*.
2. **"Has a human/Planner approved this to run, or is it on hold?"** — a *non-derivable decision*.

Every pain in the audit traces to that conflation. The fix is a single principle: **store decisions, derive facts.** A value is stored if and only if it cannot be recomputed from other stored values.

The bet (claim-struct-and-events): the two most expensive incident classes both come from hand-maintained multi-field invariants, and both die if state becomes **structural instead of conventional**.
- The ~9h "invisible in_progress" bug exists because in-progress-ness is spread across 4 columns held together by an all-4-or-none rule living only in comments + 10 clearing sites. Collapse to **one nullable `claim` value** → "partial claim" stops being *representable*.
- The "strand in blocked" bug exists because readiness is *materialized* by a fan-out that can be missed. Stop materializing it; derive it. Re-anchor the daemon-wake on the **two input events that are the only things that can newly make any todo claimable** — a dep going terminal, and an approval being set. The interval scan stays as a correctness-free latency net.

This is deliberately a **column-add + predicate-extract**, additive on the live SQLite file, daemon migrated before any UI. The enum stays at 8 values initially; we migrate *readers*, not enum *values*.

---

## TARGET MODEL

### Columns ADDED (additive, nullable — cheap on live SQLite)

```ts
approvedAt: string | null     // ISO. Written ONLY by the Planner. Null = not approved.
approvedBy: string | null     // audit
heldAt:     string | null     // ISO. Written by Steward/human (+ lease-exhaustion). Null = not held.
heldReason: string | null     // 'manual' | 'retry-exhausted' | 'migrated-park' | free text
claim:      ClaimStruct | null // ONE column (TEXT JSON), the derived-truth for in_progress
```

### Columns COLLAPSED (4 → 1)

```ts
interface ClaimStruct {
  by: string;       // was claimedBy
  token: string;    // was claimToken
  at: string;       // ISO, was claimedAt
  leaseMs: number;  // was claimLeaseMs
}
// Physical: one new column `claim TEXT NULL`.
// in_progress  ≡  claim != null
// expired      ≡  claim != null && Date.now() > Date.parse(claim.at) + claim.leaseMs
```

The four legacy columns (`claimedBy/claimToken/claimedAt/claimLeaseMs`) **stay physically present** through stages 1–5 but become **write-frozen** — read/written only via one accessor pair `readClaim(row)/writeClaim(row, c|null)`, and the `Todo` type exposes only `claim`. They are dropped physically in the deferred cleanup.

> **Honest caveat (judge):** while the legacy columns remain, the "one value can't be half-set" guarantee is *conventional* (enforced by the accessor) until the deferred physical drop. The accessor is the single mutator, so a partial claim cannot be expressed by any code path — but the columns themselves still exist. This is an accepted, time-boxed gap, not a permanent compromise.

### Columns KEPT, unchanged (already orthogonal — do not touch)

`acceptanceStatus`, `completedBy`, `completedAt`, `decisionRef`, `claimProbe`, `objectRef`, `parentId`, `dependsOn[]`, `retryCount`, `type`, `targetProject`, `assigneeSession`, `assigneeKind`, `executedBySession`, blueprint link, checklist.

### The enum — KEPT at 8 values, MEANING shrunk (NOT rewritten)

`status` stays physically `backlog|planned|todo|ready|in_progress|blocked|done|dropped`. After migration only **three values are trusted**:
- `done`, `dropped` — terminal, authoritative.
- `planned` — proxy for "exists, pre-terminal" (and the other pre-terminal values are treated identically).

`ready`, `blocked`, `todo`, `backlog`, `in_progress` become **legacy noise the predicate ignores**:
- `ready` → re-expressed as derived `isClaimable`.
- `blocked` → see STATE-TRANSITION MAP; its three meanings split into derived (deps) + `heldAt` (decision) + `acceptanceStatus='rejected'` (already stored).
- `in_progress` → derived from `claim != null` (claim wins; the enum follows but is not trusted).

The full 4-value enum rewrite (`planned|in_progress|done|dropped`) is the **DEFERRED end-state**, reached only after the last UI reader migrates — never in the staged path.

### The done-ness contract (grafted from intent-vs-state)

> **Documented contract (no schema change):** `done` is a *lifecycle fact*; the *reason* it is done is carried by the already-stored siblings `acceptanceStatus` / `completedBy` / `decisionRef`. The three paths to done (agent-gate accepted / human completion / decision-gate auto-complete) all write the same `status='done'`. UI reads `status==='done'` (or, post-migration, terminal-ness) for *whether* done, and reads the siblings only to *label why*. This closes pain (d) in prose; it needs no new column.

---

## THE ONE `isClaimable` PREDICATE

**Lives in a new module, TypeScript only:** `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/claimability.ts`. This is the only module in the repo permitted to decide eligibility. **No SQL view re-encodes the rule** (the forbidden second copy — the audit already paid for the materialized-vs-recomputed `ready` drift).

```ts
import type { Todo } from './todo-store';

export type ClaimReason =
  | 'claimable'
  | 'terminal'        // status done|dropped
  | 'in-flight'       // claim != null
  | 'human-assignee'  // fully-unblocked + approved human todo (incl. [GATE]) → actionable in HumanInbox, NOT daemon-claimed
  | 'unapproved'      // approvedAt == null
  | 'held'            // heldAt != null
  | 'dep-rejected'    // a dep is acceptanceStatus==='rejected' (DISTINCT, recoverable)
  | 'deps-pending';   // a dep is not yet terminal
  // 'probe-failing' is NOT decided here — daemon layers the live probe on top.

// pure; byId is already in-memory at every call site (audit finding d) — zero new I/O.
// NOTE behavior change vs todo-store.ts:787 — see HARD PARTS #6.
export function depSatisfied(dep: Todo | undefined): boolean {
  return !!dep && dep.status === 'done' && dep.acceptanceStatus !== 'rejected';
}

export function claimReason(t: Todo, byId: Map<string, Todo>): ClaimReason {
  if (t.status === 'done' || t.status === 'dropped') return 'terminal';
  if (t.claim != null)                               return 'in-flight';
  // Decision + dependency gates apply to BOTH agent and human todos — a human
  // todo with unsatisfied/rejected deps or no approval must NOT read actionable.
  // Check them FIRST; the agent-vs-human split is the LAST step.
  if (t.approvedAt == null)                          return 'unapproved';
  if (t.heldAt != null)                              return 'held';
  // dep-rejected ordered BEFORE deps-pending so the recoverable blocker surfaces first
  if ((t.dependsOn ?? []).some(id => byId.get(id)?.acceptanceStatus === 'rejected'))
                                                     return 'dep-rejected';
  if (!(t.dependsOn ?? []).every(id => depSatisfied(byId.get(id))))
                                                     return 'deps-pending';
  // Fully unblocked + approved. Only AGENT todos are daemon-claimable; a human
  // todo at this point is "actionable by a human" (HumanInbox), not auto-claimed.
  if (t.assigneeKind === 'human')                    return 'human-assignee';
  return 'claimable';
}

export const isClaimable = (t: Todo, byId: Map<string, Todo>): boolean =>
  claimReason(t, byId) === 'claimable';

// GRAFT (orthogonal-flags): legacy-shaped label for unmigrated UI during the long tail.
// Lets a UI site render a sensible DERIVED label instead of branching on the shadow enum.
export function derivedStatus(t: Todo, byId: Map<string, Todo>): string {
  if (t.status === 'done' || t.status === 'dropped') return t.status;
  if (t.claim != null)        return 'in_progress';
  if (isClaimable(t, byId))   return 'ready';
  if (t.approvedAt == null)   return 'planned';
  return 'blocked';
}
```

**Exact boolean** (`isClaimable`, modulo the daemon-side live probe):
```
status ∉ {done,dropped}
  ∧ claim == null
  ∧ assigneeKind === 'agent'
  ∧ approvedAt != null
  ∧ heldAt == null
  ∧ dependsOn.every(d ⇒ d.status === 'done' ∧ d.acceptanceStatus ≠ 'rejected')
```

**Probe seam:** `claimProbe` needs a live network probe (impure). The TS predicate returns "claimable-modulo-probe"; the **daemon** runs the probe at claim time as the final gate (unchanged behavior). UI renders `claimReason`/`derivedStatus` verbatim and never re-derives past a probe.

**CAS guard is a NARROWING, not a second rule:** `claimTodo`'s atomic `UPDATE` becomes
`WHERE claim IS NULL AND status NOT IN ('done','dropped')` (plus approval/hold guards). Documented as subordinate to `isClaimable` — optimistic-concurrency, never an independent definition.

### Every caller

| Caller | Today | After |
|---|---|---|
| `coordinator-daemon.ts:141` (daemon claim path) | reads materialized `ready` | `isClaimable` (map already built) |
| `todo-store.ts:650` `listReadyTodos` | recompute `ready && !claimedBy` | `all.filter(t => isClaimable(t, byId))` |
| `todo-store.ts:508` `claimTodo` CAS | `WHERE status='ready' AND claimToken IS NULL` | `WHERE claim IS NULL AND status NOT IN ('done','dropped')` (narrowing) |
| `funnel.ts:51` | `status==='ready' && !claimedBy` | `claimReason(t,byId)` grouping |
| `BridgeDashboard.tsx:357` | same | `claimReason` |
| `PlanWorkspace.tsx:55` readyCount | `status==='ready'` | `isClaimable` |
| `PlanWorkspace.tsx:54` PROMOTABLE | status set membership | `approvedAt == null` (pure approval) |
| `humanInboxSelectors.ts:57` | ready count | `claimReason` |
| `HumanInbox.tsx:100` ready-action | `status==='ready'` | `claimReason==='human-assignee'` (the fully-unblocked human-actionable signal; deps/approval/hold already gated upstream in the predicate) |
| `PlanPanel.tsx`, lifecycle readers | `status` | keep reading `status` (terminal/running only) — or `derivedStatus` during the tail |

UI **never re-derives** — it renders `claimReason`/`derivedStatus` verbatim. **Drift oracle (cheap CI grep, grafted from predicate-authority — but NOT its codegen/view machinery):** `grep -rn "status *===* *['\"]ready['\"]\|status *===* *['\"]blocked['\"]" src/ ui/src/` returns nothing outside `claimability.ts` after stage 6, and no `claimable_todos` SQL view exists.

---

## STATE-TRANSITION MAP (after the change)

### Who writes what — each role owns exactly one writable axis

| Writer | Writes | Site |
|---|---|---|
| **Planner** (sole approval authority) | `approvedAt`/`approvedBy` | `supervisor-routes.ts:184-192` — flips `approvedAt`, **not** `status` |
| **Steward / human** | `heldAt`/`heldReason`; clears a dep's `acceptanceStatus='rejected'` | new hold path; rejection-reset via existing `resetTodo:992` |
| **Daemon** | `claim` (set/clear via `writeClaim`), `retryCount` | `claimTodo`, lease/orphan reclaim, `releaseClaim`. **Never** touches `approvedAt`/`heldAt`. |
| **Lease exhaustion** | `heldAt`, `heldReason='retry-exhausted'` (instead of `status='blocked'`) | `releaseExpiredClaims:554` |
| **Gate / human / decision-gate** | terminal `status='done'` + `acceptanceStatus`/`completedBy`/`decisionRef` | `completeTodo:828`, `completeGatesForDecision:740` — unchanged |
| readiness | **nobody** | derived by `claimReason` |

The daemon has **no write path to `approvedAt`** → it structurally cannot self-approve.

### What replaces the `blocked→ready` fan-out

**Deleted entirely** (`completeTodo:833-846`). Nothing materializes `ready`, so there is nothing to miss. Dependents become claimable automatically on the next derive. The "strand in blocked" class is gone by construction. (The epic rollup at `:852-867` STAYS — it is real terminal-propagation, not readiness.)

### Reclaim/expiry on the new claim

- `releaseExpiredClaims`: `if expired → if retryCount+1 > MAX_CLAIM_RETRIES then setHeld('retry-exhausted'); SET claim=NULL, retryCount=next` — ONE write.
- `reclaimClaim` (`:569`) and `reclaimOrphan` (`:596`) **merge into one function.** Their only difference was `claimToken IS NOT NULL` vs ANY; with one struct there is no half-claimed row to distinguish. Orphan ≡ `claim != null` past lease. The 19b097a1 gap (in_progress + claimToken NULL) is **unrepresentable**.
- Startup reconcile (`openDb:267-270`): becomes "claim implies non-terminal" — and mostly moot since `in_progress` is derived from `claim`.

### What replaces the status→ready event-kick — emit on the INPUT edges only

Keep the in-process `fireOrchestratorKick` seam (`orchestrator-kick.ts`), best-effort + debounced — **no message bus.** Old fire sites (`createTodo:402`, `updateTodo:480`, `completeTodo:871`, `resetTodo:1024`) are replaced by exactly the input edges that can newly satisfy the predicate for *some* todo:

1. **Dep went terminal** — in `completeTodo`, after the `done`/`dropped` write → `kick('dep-terminal')`. The only mutation that flips a *dependent's* deps-satisfied false→true.
2. **Approval set** — `supervisor-routes.ts` when `approvedAt` goes null→non-null → `kick('approved')`.
3. **Hold cleared / dep-rejection reset** — `resetTodo` → `kick('unheld')`.
4. **Claim released (capacity)** — `releaseClaim` → `kick('capacity')`.

**The sharpest correctness argument (keep verbatim):** creating an unapproved todo, a dep still pending, a hold still on — *none* can produce a `claimable` todo, so waking the daemon would find nothing. The kick is therefore provably a **latency optimization**: every claimable todo is found by the next interval scan regardless of whether a kick fired. **A missed kick can never strand work.** The interval scan stays, demoted from "correctness backstop" to "steady-state poller + probe servicer."

### What 'blocked' becomes

Not a stored readiness state. Its three old jobs split:
- **deps-pending** → derived (`!depsSatisfied`), never stored.
- **dep-rejected** → derived from the dep's `acceptanceStatus='rejected'`, a *distinct* `ClaimReason`.
- **decision-hold / retry-exhausted park** → `heldAt` (the only honest stored "blocked").

---

## MANUAL STATUS WRITES — the UI dropdown seam (added: a human can set the enum directly)

The model above makes `ready`/`blocked`/`in_progress` **derived**, but three UI paths **write the enum directly today** — two of them write exactly those now-derived values. A dropdown that writes a derived value is incoherent unless we translate it. These writes are *legitimate human intent*; they map cleanly onto the new decision verbs, so each WRITE endpoint becomes a **translation seam** — the single chokepoint that rewrites a status-write into a decision-write. No new concept; we re-point existing writes.

### The three writers (audit)

| UI control | Values it can write | Endpoint |
|---|---|---|
| **TodoDetailView** `<select>` (`TodoDetailView.tsx:216-225`) | **ALL 8** incl. `ready`/`blocked`/`in_progress` | `PATCH /api/session-todos/{id}` → `api.patchSessionTodo` |
| **BridgeEscalationInbox** dispositions (`:304-321`) | `ready`, `blocked` | `PATCH /api/supervisor/todos` (`promoteTodo`) |
| **HumanInbox** Claim / Complete (`:100-118`) | `in_progress`, `done` | parent `onClaim`/`onComplete` callbacks |

### The translation (status-write → decision-write), enforced at the STORE MUTATOR (not the HTTP routes)

> **Layer correction (poke #1):** the seam must live in the **store mutator** — `todo-store.updateTodo`/`createTodo` — NOT in the two HTTP route handlers. The PATCH routes are only *two* of the writers; the **MCP tools** (`update_session_todo`, `reset_todo`, `override_accept_todo`, and `create_todo` with `status:'ready'`) write through `todo-store` directly, bypassing HTTP. Put the translation in the routes and an MCP `update_session_todo({status:'ready'})` re-creates the lying enum. One chokepoint at `updateTodo`/`createTodo` covers every surface (HTTP, MCP, scripts) with a single rule.

A human (or any caller) setting a status is expressing a decision or a lifecycle move. `updateTodo`/`createTodo` rewrite it; the daemon/predicate never see a hand-set derived enum:

| User picks | Means | Endpoint writes | Notes |
|---|---|---|---|
| `ready` | "approve to run" | `approvedAt = now`, `approvedBy`; clear `heldAt` | identical to the Planner's approve verb |
| `blocked` | "hold this" | `heldAt = now`, `heldReason='manual'` | the only honest manual "blocked" |
| `in_progress` | (fabricated claim) | **reject from the menu** | a human inventing a claim is nonsensical; HumanInbox "Claim" goes through `claimTodo`/`writeClaim`, not a raw status set |
| `planned`/`backlog`/`todo` | "un-approve / park pre-run" | clear `approvedAt`; `status='planned'` | real lifecycle move |
| `done`/`dropped` | terminal | `status` + `acceptanceStatus`/`completedBy` (unchanged) | real lifecycle move |

So **BridgeEscalationInbox**'s "Dismiss + re-ready" → approve; "Dismiss + block" → hold. **HumanInbox** "Complete" → terminal (unchanged); "Claim" → `claimTodo` (already correct, just not a raw status set).

### TodoDetailView dropdown — staged change

- **During migration (S3):** keep the dropdown shape, but the endpoint translates (above). Selecting `ready`/`blocked` silently sets `approvedAt`/`heldAt`; the row re-derives. Backward-compatible — no UI change needed to ship the daemon.
- **At the UI migration (S5):** replace the 8-value `<select>` with the honest controls: an **Approve** toggle (writes `approvedAt`), a **Hold** toggle (writes `heldAt`/`heldReason`), and a small lifecycle select (`planned` / `done` / `dropped`). The derived state (`derivedStatus`) is shown **read-only** beside them ("now: ready / blocked: dep rejected / in progress"). The user sets *intent*; the system shows the *derived fact*.

### Endpoint guardrail (drift-safety extends to the write side)

After S3, **no write path accepts a derived enum value as a stored status.** Because the seam is in `updateTodo`/`createTodo`, every caller (HTTP, MCP, scripts) is covered: a status-write of `ready`/`blocked`/`in_progress` translates to the decision-write; it can only ever be *derived*, never *stored by a writer*. This is the write-side mirror of the read-side grep oracle: add a store-level assertion/test that a status-write of a derived value translates (never persists). Closes the loophole where a stale client, an MCP tool, or a script writes a raw `ready` and re-creates a trustable lying enum.

---

## HARD PARTS — how each named bug class becomes impossible

1. **Stranded-in-blocked / dormant-but-ready** → impossible: readiness is derived every tick; no materialized flag to go stale. A missed kick costs latency, never correctness.
2. **Predicate drift (daemon vs UI)** → impossible by single-definition: one TS function, zero SQL re-encodings, UI renders `claimReason`/`derivedStatus` verbatim. Enforced by the cheap grep oracle in CI.
3. **Invisible in_progress / partial claim** → unrepresentable: `claim` is one value via one accessor; `in_progress ≡ claim != null`, so the enum can't disagree. `reclaimClaim`/`reclaimOrphan` collapse to one `claim IS NULL?` check.
4. **dep-rejected indistinguishable, no recovery** → impossible: `claimReason` returns `dep-rejected` (ordered before `deps-pending`); Steward clears the dep's rejection via existing `resetTodo` → dependent re-derives claimable next tick, no manual re-promote.
5. **Daemon self-approving** → impossible: `approvedAt` is the only approval input, only the Planner writes it; the daemon has no write path to it.
6. **A held todo auto-claimed** → impossible: `heldAt != null` short-circuits `isClaimable`.

> **IMPLEMENTER CORRECTION (judge, load-bearing):** the real `depSatisfied` (`todo-store.ts:787`) keys **only** on `status==='done'`, NOT on `acceptanceStatus !== 'rejected'`. The new predicate ADDING the `acceptanceStatus !== 'rejected'` clause is a **genuine behavior change** — it newly blocks dependents of rejected-but-done deps (that is precisely the dep-rejected fix). **Call this out in the stage-4 soak**; it alters live claim behavior, not just labeling.

---

## STAGED MIGRATION (each step independently shippable on the live DB)

**S1 — Add columns + claim accessor + backfill (pure additive migration).**
In `addColumnIfMissing` (~`todo-store.ts:249`): add `approvedAt, approvedBy, heldAt, heldReason, claim`. Introduce `readClaim`/`writeClaim` over the existing 4 columns and route the existing 10 clear-sites + `claimTodo` through them (pure refactor, same behavior; legacy columns become write-frozen). No reader changes — old code runs unchanged. Run the one-shot backfill (below) in the same guarded block. Cheapest possible live-DB step.

**Backfill rule (one-shot, idempotent, guarded by a version flag):**
- **`approvedAt` (load-bearing):** every row with `status IN ('ready','blocked','in_progress','done','dropped')` was Planner-approved (only the Planner leaves `planned`) → `approvedAt = updatedAt`. Rows in `planned`/`backlog`/`todo` → `NULL`. *Get this wrong and approved work goes dormant.*
- **`heldAt` (existing `blocked` rows):** recompute `depsSatisfied`. If deps NOT satisfied → leave `heldAt` NULL (re-derives as `deps-pending`/`dep-rejected`). If deps satisfied AND (`retryCount >= MAX_CLAIM_RETRIES` OR no open deps) → `heldAt = updatedAt, heldReason='migrated-park'`. **Conservative rule: when ambiguous, set `heldAt`** — a spurious hold is a visible, human-clearable nuisance; a spurious auto-claim re-runs work.
- **`claim` (existing `in_progress` rows):** pack the 4 legacy columns into the JSON struct. If any of the 4 is NULL (the orphan class) → `claim = NULL` (it'll re-derive claimable).
- **enum:** untouched. `ready`/`blocked` rows keep their value; the predicate ignores it.

**S2 — Write `claimability.ts` + unit tests.** `depSatisfied`/`claimReason`/`isClaimable`/`derivedStatus`, exhaustive tests for every `ClaimReason` branch (esp. `dep-rejected` vs `deps-pending` ordering, orphan-as-null, human-assignee, probe). No callers yet. Ships dead-code.

**S3 — Migrate the daemon first (correctness-critical, smallest reader set).** `listReadyTodos`, `claimTodo` CAS narrowed, merge `reclaimClaim`+`reclaimOrphan`, `releaseExpiredClaims` reading `claim` and writing `heldAt` on exhaustion. Planner writes `approvedAt`. Retarget kicks to the input edges. **Add the write-side translation seam in the STORE MUTATOR** (`updateTodo`/`createTodo`, covering HTTP + MCP + scripts): a status-write of `ready`→approve, `blocked`→hold, `in_progress`→reject, per the MANUAL STATUS WRITES table — so the existing dropdowns keep working unchanged while the daemon goes live. **Soak** — this is where the depSatisfied behavior change (HARD PARTS #6) lands.

**S4 — Drop the fan-out.** Delete `completeTodo:833-846`; keep the single `dep-terminal` kick. Interval net now provably carries correctness. Delete `invariant-check.ts:156` "blocked-on-nothing" (its reason to exist is gone).

**S5 — Migrate the ~30 UI sites incrementally.** Each swaps `status==='ready'|'blocked'` for `claimReason(t,byId)` (or `derivedStatus` for sites not yet ready to render distinct chips). `dep-rejected`/`deps-pending`/`held` chips fall out free. Daemon-adjacent dashboards (`funnel.ts`, `BridgeDashboard`) first; long tail later. One PR per cluster. **Includes replacing the TodoDetailView 8-value `<select>` with Approve/Hold toggles + a lifecycle select + a read-only derived-state label** (MANUAL STATUS WRITES §), and relabeling the BridgeEscalationInbox dispositions ("re-ready"→"Approve", "block"→"Hold").

**S6 — Sweep-as-net (keep, repurpose — do NOT have it write the shadow enum).** `sweepEpicRollups`/reconcile stop "fixing missed fan-outs"; they now **assert invariants** (claim ⟺ in-flight; no terminal-with-claim; held never auto-claimed; epic rollup) and alarm instead of repair. **Explicitly DROP** orthogonal-flags' idea of cosmetically rewriting the shadow enum — that would re-create a trustable lying value. Unmigrated readers use `derivedStatus`, not a swept enum. Should find nothing in steady state.

---

## BEFORE / AFTER

Work todo **W** `dependsOn: [A, B]`, Planner-approved. **A** done+accepted; **B** done but `acceptanceStatus='rejected'`. The fan-out missed W.

### BEFORE (conflated)
```jsonc
{ "id":"W", "status":"blocked", "dependsOn":["A","B"],   // why blocked? unknowable
  "acceptanceStatus":null, "completedBy":null,
  "claimedBy":null,"claimToken":null,"claimedAt":null,"claimLeaseMs":null }
// A: {status:"done", acceptanceStatus:"accepted"}
// B: {status:"done", acceptanceStatus:"rejected"}
```
UI shows generic "blocked", indistinguishable from deps-pending. Recovery is manual reset of B *plus* a manual re-promote of W (the fan-out won't fire on a manual B edit); if the fan-out missed, W strands forever.

### AFTER (de-conflated)
```jsonc
{ "id":"W", "status":"blocked",          // legacy noise; predicate ignores it
  "dependsOn":["A","B"],
  "approvedAt":"2026-06-16T09:00:00Z", "approvedBy":"planner",
  "heldAt":null, "heldReason":null,
  "claim":null, "acceptanceStatus":null, "completedBy":null }
// A: {status:"done", acceptanceStatus:"accepted"}
// B: {status:"done", acceptanceStatus:"rejected"}

claimReason(W, byId)  →  'dep-rejected'   // distinct, actionable
```
UI renders a distinct **"blocked: dependency rejected (B)"** chip. **Recovery is automatic:** Steward clears B's rejection via `resetTodo` → fires `kick('unheld')`/`dep-terminal` → next derive `claimReason(W)==='claimable'` → daemon claims, `claim` set, derived `in_progress`. **No manual re-promote, no fan-out, nothing to strand.** Even with zero kicks, the interval poller finds W. The claim is a full struct or null — never a half-set ghost.

---

## WHY THIS OVER THE ALTERNATIVES

- **vs status-shrinks (delete `ready`/`blocked` up front):** correct end-state, but a big-bang reinterpretation forcing value migration + 40+-reader surgery up front — exactly what the minimal-staged mandate penalizes. We keep its 4-value enum as the **deferred** target, not the staged path.
- **vs intent-vs-state (two new enums + `parked`):** cleanest conceptual model, and we **graft its done-ness contract**, but two new enums + a 4th value + a final `status`-drop is more new surface than "enum stays initially" wants. We fold `parked` into `heldReason='retry-exhausted'`.
- **vs predicate-authority (codegen'd SQL view + CI fence):** highest drift-safety on paper, but it **builds the second copy of `depsSatisfied` the brief forbids** (a SQL view re-encoding the rule) plus a spec-DSL + generator — heavy machinery for a single-user in-memory-map app. We keep only its **cheap grep oracle**, drop the view/codegen.
- **vs orthogonal-flags:** we graft its `derivedStatus` shim (de-risks the long UI tail) but **drop** its sweep-writes-the-shadow-enum idea (re-creates a trustable lying value).

### Top risks
1. **The `depSatisfied` behavior change** (HARD PARTS #6) — newly blocks dependents of rejected-but-done deps. Mitigate: explicit S3 soak + tests.
2. **`approvedAt` backfill miss** — approved work goes dormant. Mitigate: the precise status-set rule above + a post-migration assertion (count of `approvedAt IS NULL AND status NOT IN planned/backlog/todo` must be 0).
3. **Conventional (not yet physical) claim atomicity** while legacy columns linger — mitigated by the single accessor; closed by the deferred drop.
4. **Stragglers reading raw `status`** during the tail — mitigated by `derivedStatus` + the grep oracle gating CI.

---

## DEFERRED (named, NOT built now)

- **Physically drop** the 4 legacy claim columns (`claimedBy/claimToken/claimedAt/claimLeaseMs`) — converts claim atomicity from conventional to physical.
- **God-table split:** move `claim` / `acceptance` / `decision` into their own tables. The whole design above is column-add + predicate-extract specifically to avoid centering on this.
- **Full enum rewrite** to the real 4 values (`planned|in_progress|done|dropped`) — reached only after the last UI reader migrates (the grep oracle confirms zero readers).

---

## KEY FILES

- **NEW** `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/claimability.ts`
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/todo-store.ts` — `Todo` (27-86), migration/backfill (~249), claim accessor routing (501-632), `depSatisfied` (787), delete fan-out (833-846), `listReadyTodos` (650-658), lease→`heldAt` (554)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/coordinator-daemon.ts:141`
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/orchestrator-kick.ts`
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/services/invariant-check.ts` (delete `:156`)
- `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/supervisor-routes.ts:184-192`
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/supervisor/bridge/funnel.ts:51`
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/supervisor/PlanWorkspace.tsx:54-55`
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/todos/humanInboxSelectors.ts:57`
- **Write seam:** `/Users/benmaderazo/Code/claude-mermaid-collab/src/routes/session-todos*.ts` (the `PATCH /api/session-todos/{id}` handler) + `supervisor-routes.ts` — both translate status-writes to decision-writes
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/editors/TodoDetailView.tsx:216-225` (8-value select → Approve/Hold + lifecycle + read-only derived label)
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/supervisor/bridge/BridgeEscalationInbox.tsx:304-321` (dispositions → Approve/Hold)
- `/Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/todos/HumanInbox.tsx:100-118` ("Claim" routes through `claimTodo`, not a raw status set)
