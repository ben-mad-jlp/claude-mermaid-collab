# Blueprint — [Daemon] Accepted leaf re-claimed and rejected (in-flight leaf re-enters the pipeline)

## Problem (root cause)

A headless leaf runs via **fire-and-track**: the orchestrator tick claims the todo
(`status → in_progress`, `claim` set with `COORDINATOR_EPOCH`), launches the leaf in a
background continuation, and returns (`src/services/coordinator-live.ts:1865-1922`,
`src/services/coordinator-daemon.ts:206-222`). The leaf-executor runs **in-process** for
the whole blueprint→implement→review run (minutes, multiple nodes).

Nothing keeps the daemon's reconcile passes from reclaiming that still-running leaf
mid-run. Two facts combine:

1. **The leaf-executor lane is invisible to the liveness probes.** `inProcessLaneAlive`
   (`coordinator-live.ts:160-167`) only asks the **grok** and **anthropic-core** harnesses
   — NOT the leaf-executor. `laneConfirmedDead` (`:420-427`) then sees no tmux session for
   the in-process leaf (`isTmuxAlive` → false) and reports **dead**. So a perfectly alive
   leaf reads as dead to the reaper.
2. **`leaf_inflight` only covers the inside of a node, not the gaps.** The executor sets
   the row immediately before each node's invoke and clears it in a `finally` the instant
   the node returns (`leaf-executor.ts:1019-1058`). Between nodes (blueprint→implement,
   merge-back, gate eval) there is **no** inflight row at all.

Result: `reapOrphanedLeaves` (`coordinator-live.ts:1977-2093`) reclaims the live leaf via
`reclaimOrphan` — most dangerously the **prior-epoch fast path** (`:2008-2024`, reclaims
with **no** liveness probe after a hot-swap mints a new `COORDINATOR_EPOCH`), or the
pulse/grace paths once a long node's pulse goes stale. `reclaimOrphan` clears `claim` and
resets `status → 'ready'` (stored 'planned', `approvedAt` intact). Now:

- `claimReason` (`claimability.ts:72-97`) no longer returns `'in-flight'` (claim is null),
  falls through to `'claimable'` → `derivedStatus` returns `'ready'` (`:108-114`).
- `claimGuard` (`coordinator-live.ts:1557-1571`) and `diagnoseClaimSuppression`
  (`:957-990`, the read-model behind `claimSuppression.claimableIds`) re-admit the leaf.
- The next tick re-claims and **double-dispatches** the running leaf. If it had already
  been **accepted** (terminal), the second run finishes and overwrites the accept with a
  reject (epic `391c0d9e`: `26a55a53` accepted 09:00, re-run+rejected 09:06).

**Fix strategy:** make "this leaf has an open fire-and-track run" an authoritative,
gap-free signal, and exclude such a leaf from (a) reclaiming, (b) the claimable set, and
(c) the claimable read-model. The claim/`in_progress` is then held for the WHOLE run and
released only on a terminal outcome or a genuine pause — never mid-run. With the claim
held, `derivedStatus` correctly returns `'in_progress'` (not `'ready'`) transitively, so
`claimability.ts` needs **no** change (it stays pure / zero-I/O per its module contract).

## Authoritative "leaf run is active" signal

Two arms, OR'd — the in-memory arm is gap-free within a process; the ledger arm satisfies
the literal acceptance ("a live `leaf_inflight` row") and covers test/diagnostic callers:

1. **In-memory continuation registry (primary, gap-free):** a module-level
   `Set<string>` of leafIds with an open fire-and-track continuation in THIS process.
   Added synchronously when the continuation is launched; removed in its `finally`
   (covers terminal AND pause — pause intentionally re-dispatches, so clearing there is
   correct).
2. **Live `leaf_inflight` row (secondary, cross-process / node-active):** a this-epoch
   row in `leaf_inflight`.

## Changes

### 1. `src/services/worker-ledger.ts` — expose a live-inflight predicate

Add, next to `listLeafInflight` (`:417-424`):

```ts
/** True iff a LIVE (this-process / this-epoch) in-flight row exists for `leafId`.
 *  Other-epoch (dead-daemon) rows are ignored — they are reaped by reapStaleInflight.
 *  Used by the coordinator to never reclaim/re-claim a leaf whose node is running. */
export function isLeafInflightLive(leafId: string): boolean {
  try {
    return openDb()
      .prepare('SELECT 1 FROM leaf_inflight WHERE leafId = ? AND epoch = ? LIMIT 1')
      .get(leafId, LEDGER_EPOCH) != null;
  } catch { return false; }
}
```

`LEDGER_EPOCH` is already module-private (`:120`); reuse it. Best-effort (any DB error →
false) matching the surrounding functions.

### 2. `src/services/coordinator-live.ts` — continuation registry + guards

**(a) Module-level registry + predicate** (near the other in-memory daemon maps, e.g.
after `lastSpawnAttempt`/`coldStartsInFlightByProject` ~`:309-330`). Import
`isLeafInflightLive` from `./worker-ledger` (extend the existing import at `:9`).

```ts
/** Leaves with an OPEN fire-and-track continuation in THIS process — added at launch,
 *  removed in the continuation's finally (terminal OR pause). Gap-free across the whole
 *  blueprint→implement→review run, including the between-node gaps the leaf_inflight row
 *  does not cover. The daemon must never reclaim or re-claim a leaf in this set. */
const activeLeafRuns = new Set<string>();
export function markLeafRunActive(leafId: string): void { activeLeafRuns.add(leafId); }
export function clearLeafRunActive(leafId: string): void { activeLeafRuns.delete(leafId); }
/** Authoritative "this leaf is actively being driven right now": an open continuation in
 *  this process, OR a live this-epoch leaf_inflight row (node mid-invoke / cross-process). */
export function isLeafRunActive(leafId: string): boolean {
  return activeLeafRuns.has(leafId) || isLeafInflightLive(leafId);
}
```

**(b) Register/deregister around the fire-and-track continuation** (`launchWorker`,
`:1872-1922`). Add the mark **synchronously before** `void (async () => {` (must precede
any await so a same-tick re-entry can't race), and the delete in the existing `finally`
(`:1914-1918`, which already runs on terminal AND the pause `return` at `:1897`):

```ts
const ledProject = todo.targetProject ?? project;
markLeafRunActive(todo.id);            // ← add: claim is now held for the whole run
void (async () => {
  try { /* ...unchanged... */ }
  catch (e) { /* ...unchanged... */ }
  finally {
    releaseLeafSlot(ledProject);
    clearLeafRunActive(todo.id);        // ← add: terminal or pause releases the guard
  }
})();
```

**(c) `claimGuard` exclusion** (`:1557-1571`). After the existing `isHeadlessLeaf`
filter and before/with the breaker gate, drop any actively-running leaf (defense-in-depth:
even if a claim were cleared, a running leaf is never re-dispatched):

```ts
claimable = claimable.filter((t) => isHeadlessLeaf(t, project));
claimable = claimable.filter((t) => !isLeafRunActive(t.id)); // never re-claim a live run
if (breakerOpen()) return [];
return claimable;
```

**(d) `reapOrphanedLeaves` exclusion — the ROOT fix** (`:1977-2093`). Skip any in_progress
leaf with an active run in ALL three reclaim passes, so the claim/`in_progress` is held
for the whole run:

- **Prior-epoch fast path** (`:2009-2024`): inside the loop, `if (isLeafRunActive(id)) continue;`
  before `reclaimOrphan`. (This is the no-liveness-probe path that fires on a hot-swap
  epoch bump — the highest-risk reclaim.)
- **Pulse fast path** (`:2036-2060`): after the `priorEpochReaped`/human/epic guards,
  add `if (isLeafRunActive(t.id)) continue;` before the pulse-stale check.
- **Grace fallback** (`:2064-2091`): in the candidate loop, add
  `if (isLeafRunActive(c.id)) continue;` before `reclaimOrphan`.

`reapStaleInflight()` is still called first (`:1994`) so other-epoch rows are gone before
`isLeafInflightLive` is consulted — only genuinely-live rows remain.

**(e) `diagnoseClaimSuppression` read-model** (`:957-990`). The reported `claimableIds`
must never contain a running leaf (acceptance: never reads `derivedStatus 'ready'` /
never in `claimableIds`). After computing `afterHeadless` (`:971`), exclude active runs
and attribute the suppression:

```ts
const afterHeadless = afterBp1.filter((t) => isHeadlessLeaf(t, project));
const notInflight = afterHeadless.filter((t) => !isLeafRunActive(t.id));
const headlessOk = ids(notInflight);
// ...
const claimable = projectGate ? [] : notInflight;
```

Add an `in-flight` reason to `classifyClaimSuppression` (`:996-1009`): a leaf that passed
`headless` but is filtered as in-flight should report `reason: 'in-flight (leaf run
active — node executing or open fire-and-track continuation)'`. Simplest: thread a
`inflightOk: Set<string>` parameter (mirroring `headlessOk`) so the classifier attributes
`!inflightOk.has(id)` after the headless check. Update the single caller accordingly.

### 3. Tests

**`src/services/__tests__/worker-ledger.test.ts`** — `isLeafInflightLive`:
- returns true for a same-epoch `setLeafInflight` row; false after `clearLeafInflight`;
  false for an unknown leafId.

**`src/services/__tests__/coordinator-fire-and-track.test.ts`** (or a focused new block
in `coordinator-daemon.test.ts` if cleaner) — claim-eligibility vs in-flight:
- Mark a leaf active via `markLeafRunActive(id)` (and/or `setLeafInflight`): assert it is
  EXCLUDED from `makeCoordinatorDeps().claimGuard(project, [leaf])` output.
- Assert `diagnoseClaimSuppression(project).claimableIds` does NOT contain an
  active-run leaf, and `suppressed` attributes it `in-flight`.
- `reapOrphanedLeaves`: an in_progress leaf that `isLeafRunActive` is NOT reclaimed even
  when it is pulse-stale + lane-confirmed-dead AND when its claim is a prior epoch
  (`planPriorEpochReap` would otherwise reclaim it with no probe). After
  `clearLeafRunActive`/`clearLeafInflight`, the same leaf IS reclaimed (guard is the only
  thing holding it).
- `clearLeafRunActive` in the continuation `finally` runs on BOTH terminal and pause:
  assert that after a paused outcome the leaf is re-claimable (active flag cleared).

## Acceptance mapping
- *In-flight leaf NEVER in `claimableIds`* → 2(e).
- *In-flight leaf NEVER derives `'ready'`* → 2(d) holds the claim → `claimReason`
  returns `'in-flight'` → `derivedStatus` returns `'in_progress'` (no `claimability.ts`
  change needed).
- *Accepted leaf never re-claimed* → 2(d) prevents the mid-run reclaim that flipped it
  back to ready; 2(c) is the residual-race backstop.
- *Regression test on claim-eligibility vs in-flight* → §3.

## Non-goals / notes
- `claimability.ts` stays pure (zero new I/O) — its module contract forbids ledger reads;
  the daemon layers the live signal on top exactly as it already does for `claimProbe`.
- The in-memory registry is process-scoped by design: an in-process leaf cannot survive a
  restart, and a restart's stale `leaf_inflight` rows are dropped by `reapStaleInflight`,
  so a crashed leaf still ages out via the existing orphan reaper (no new strand).

```json
{ "schemaVersion": 1, "estimatedFiles": 4, "estimatedTasks": 5,
  "nonEnumerableFanout": false,
  "filesToCreate": [],
  "filesToEdit": [
    "src/services/worker-ledger.ts",
    "src/services/coordinator-live.ts",
    "src/services/__tests__/worker-ledger.test.ts",
    "src/services/__tests__/coordinator-fire-and-track.test.ts"
  ],
  "tasks": [
    { "id": "ledger-predicate", "files": ["src/services/worker-ledger.ts"], "description": "Add isLeafInflightLive(leafId) — this-epoch live leaf_inflight row check" },
    { "id": "active-run-registry", "files": ["src/services/coordinator-live.ts"], "description": "Add activeLeafRuns Set + mark/clear/isLeafRunActive helpers; register at fire-and-track launch and clear in the continuation finally" },
    { "id": "guard-claim-and-reap", "files": ["src/services/coordinator-live.ts"], "description": "Exclude isLeafRunActive leaves in claimGuard and in all three reapOrphanedLeaves passes (prior-epoch, pulse, grace)" },
    { "id": "guard-readmodel", "files": ["src/services/coordinator-live.ts"], "description": "Exclude active runs from diagnoseClaimSuppression.claimableIds and add an 'in-flight' reason in classifyClaimSuppression" },
    { "id": "tests", "files": ["src/services/__tests__/worker-ledger.test.ts", "src/services/__tests__/coordinator-fire-and-track.test.ts"], "description": "Regression tests: isLeafInflightLive; in-flight leaf excluded from claimGuard/claimableIds; reapOrphanedLeaves never reclaims an active run (incl. prior-epoch + pulse-dead); re-claimable after clear/pause" }
  ] }
```
