# Design: EPIC → Git Integration (Feature-Branch-Per-Epic + Human-Gated Land)

## Vision

Today there is one entanglement constant — `INTEGRATION_BRANCH = 'collab/integration'` — into which every worker branch, from every epic, merges. Landing to master is a manual, all-or-nothing batch: you cannot ship one finished epic without dragging every other in-flight change with it.

The fix is to recognize that `collab/integration` was a **degenerate epic branch with N=1 and no land gate**. We generalize it: every `[EPIC]` todo owns a real long-lived branch `collab/epic/<id8>` cut off **master**. Its child todos branch off the epic branch (in their own worktrees, exactly as today) and merge back into it on acceptance. When the last child is accepted and a server-re-derived proof is green, the epic surfaces as **"ready to land"** in the human inbox; the human clicks LAND, which re-derives the proof and performs one `--no-ff` merge of the epic branch into master.

This is the existing two-tier topology (`worker → integration → master`) with the middle tier sharded per-epic and the previously-manual top merge promoted to a **proof-gated, human-confirmed** act. No new subsystem. One constant becomes a function of the epic.

**Why human-gated and not auto-land (the key graft):** master is the one asymmetric ref in a local-first single-user system — it is what `deploy.ts` ships, and it is rolled back by hand. Every ref *below* master (worker branches, the epic branch, child merges) stays fully autonomous, consistent with the steward-dogfood-always-on ethos. But the publish act itself is a decision, surfaced to the one human who is already in the loop, with the proof gate as a decision-aid rather than a license to mutate master. A flag can flip this to auto-land later if throughput beats caution.

## Chosen Topology

Per-epic integration branch `collab/epic/<id8>` off **master**; child worktrees off the epic branch, merging back into it; epic branch → master at land (human-confirmed, proof-gated). Per-child worktrees, node_modules symlinking, keep-warm pool, dead-worker reaping, and lane teardown are all **unchanged** — only the worker's base ref and the merge target change.

```
master ───●──────────────────────────────────●─────────────────────●──────▶
          │ epic branch cut off master         ▲ LAND (human click,  ▲ LAND
          │ (lazy, first child claim)           │  re-derived proof,  │
          ▼                                      │  --no-ff merge)     │
  collab/epic/<A-id8> ──◆──◆──◆───────────────────┘                    │
   __epic-<A-id8>__/      │  │  │  (merge target worktree)              │
   (per-epic integ wt)    │  │  └─ merge-back child A3 (--no-ff)        │
                          │  └──── merge-back child A2                  │
                          └─────── merge-back child A1                  │
                           ▲ each child = its own worktree+branch       │
                           │  collab/<slug>-<stamp>                     │
                           │  .collab/agent-sessions/worktrees/<lane>   │
                           │  node_modules symlinked (UNCHANGED)        │
                                                                        │
  collab/epic/<B-id8> ──◆──◆────────────────────────────────●──────────┘
   (concurrent epic B: own branch off master, own integ wt,   LAND
    own child lanes — shares NO ref with A; meets A only at
    their separate, serialized epic→master lands)

  Trailers on each --no-ff merge commit (defense-in-depth):
     Collab-Epic: <epicId>
     Collab-Todo: <todoId>
```

Two tiers, sharded:
- **Long-lived per epic:** branch `collab/epic/<id8>` + integration worktree `<baseDir>/__epic-<id8>__` (the generalized `__integration__`), one per *active* epic — not per child.
- **Ephemeral per child:** `collab/<slug>-<stamp>` worktrees, unchanged. Only their **base ref** changes from `integ.branch` to the epic branch.

Concurrent epics share no ref. They collide only if they touch the same files, and only at their respective, serialized epic→master lands.

## Lifecycle (real function names)

### A. Epic created — Planner, no git
Planner adds an `[EPIC]` todo (`isEpicTitle`, children via `parentId`). **No git happens.** The epic↔branch binding is convention-derived (`epicBranchName(epicId)`), so nothing is created or stored until a child does real work. This avoids branches for epics that never start and keeps the Planner a pure work-graph role.

### B. First child claimed — Coordinator, lazy branch creation
`runTick` → `claimTodo` → `launchWorker` (`coordinator-live.ts:~544`). In the isolation block, today:
```ts
const integ = await wm.ensureIntegration();
const wt = await wm.ensure(poolName, { baseBranch: integ.branch });
```
becomes:
```ts
const epicId = await resolveEpicId(todo, targetProject); // walk parentId → [EPIC] root; Inbox-epic fallback
const epic   = await wm.ensureEpic(epicId);              // NEW: lazy create/resume off master
const wt     = await wm.ensure(poolName, { baseBranch: epic.branch }); // EnsureOpts.baseBranch seam unchanged
```
`ensureEpic` is a clone of `ensureIntegration` (`worktree-manager.ts:541-587`): branch `collab/epic/<id8>`, path `__epic-<id8>__`, base = `detectBaseBranch()` (= master), same `branchExists ? add : add -b ... base` resume shape. First claimant creates; later claimants resume. node_modules symlinking unchanged.

### C. Child accepted — merge into the EPIC branch
`completeTodo` dep (`coordinator-live.ts:393-423`). Today calls `wm.commitAndMergeToIntegration(session, {message})`. Becomes:
```ts
const epicId = await resolveEpicId(r.completed, targetProject);
const merge  = await wm.commitAndMergeToEpic(session, epicId, { message });
```
`commitAndMergeToEpic` is `commitAndMergeToIntegration` with the `ensureIntegration()` target at `:605` swapped for `ensureEpic(epicId)`, and the `-m` message gaining `Collab-Epic`/`Collab-Todo` trailers. Everything else is byte-for-byte identical: `status --porcelain` → `add -A` → `commit` → `git merge --no-ff <workerBranch>` in the epic worktree, abort-on-conflict → `{merged:false, conflict:true}`. On success, the existing lane teardown (`wm.remove` → `killTmuxSession` → `removeSlot`, `:412-419`) runs unchanged. On conflict, the existing `assumption-invalidated` escalation fires.

### D. All children accepted — surface, do NOT auto-land
The store roll-up (`todo-store.ts` `while(parentId)` `allChildrenDone` loop) marks the `[EPIC]` todo `done` and surfaces it in `r.rolledUp` (already logged at `:382`). For each rolled-up epic, the Coordinator runs `validateStewardProof('land_epic', {kind:'epic-landable', epicId}, ctx)`. On green, it raises a distinguished inbox card via `escalation_create` (kind `epic-ready-to-land`, carrying `{epicId, epicBranch, proofSummary}`). It does **not** merge to master. On a red proof it raises the same card annotated with the blocking reason (tsc-dirty / not-mergeable). No new tick phase; this piggybacks on the existing `completeTodo` callback.

### E. Epic LANDS to master — Human click, re-derived proof
The human sees "Epic X ready to land" and clicks LAND (a new MCP-backed handler `landEpic(epicId)`). The handler **re-derives** `validateStewardProof('land_epic', ...)` server-side at click time (never trusts the surfaced summary), then calls `wm.landEpicToMaster(epicId, {message})`: in a master-checkout worktree, `git merge --no-ff collab/epic/<id8>`, same abort-on-conflict shape as `:639-660` — master left untouched on conflict. On success: `wm.removeEpic(epicId)` (worktree remove + `branch -d`), resolve the escalation. On conflict at click time: re-surface "needs human resolution in the epic worktree, then re-land."

## The Hard Parts

### (1) Branch base — off master
The epic branch is cut off master, not off integration. Off-master is what makes the epic a clean, independently-landable unit; off-integration re-entangles it with every other epic's accepted-but-unlanded work. The dependent-data-flow argument that justified branching workers off a shared ref still holds **within** an epic: children branch off the epic branch and see prior accepted siblings. Cross-epic data flow is modeled as a work-graph dep, not implicit branch ancestry. The known cost: an epic is blind to *sibling* epics' accepted work until land, so a hidden cross-epic textual dependency surfaces as one epic→master conflict — caught by the dry-merge probe (below), never silent.

### (2) Owner — Coordinator, lazily, on first child claim
Not the Planner at epic creation. This matches the existing lazy `ensureIntegration()` pattern, avoids branches for epics that never start, and keeps the Planner a pure work-graph role (it promotes; it never touches git). The branch *name* is still predictable from birth (convention-derived from the epic id), so it is surfaceable and human-addressable without eager creation.

### (3) child → epic conflict
Identical to today's child→integration. `commitAndMergeToEpic` aborts the merge, leaves the epic branch pristine, returns `conflict:true`; the existing `assumption-invalidated` escalation handles it. Smaller blast radius than today — a conflict is scoped to one epic's siblings, not the global trunk. Low-risk because children of one epic branch off the same ref and see prior accepted siblings.

### (4) epic → master conflict
The one genuinely new surface, but it happens once per epic and is caught **before** mutating master by a dry-merge probe inside the proof predicate: `git merge --no-commit --no-ff collab/epic/<id8>` in a master checkout, then `git merge --abort`. On conflict the proof returns `not-mergeable`; the epic surfaces as "ready, needs human rebase," never half-merged.

### (5) concurrent epics
Independent branches; the only interaction is at land. **Serialize land attempts** behind a per-project land mutex (trivial at single-user scale; in practice the human clicks one at a time). First epic lands clean; a second epic touching the same files fails its dry-merge against the *new* master and stays "ready" until rebased. Deterministic and visible. A periodic **staleness surface** flags "epic base is N commits behind master" — flag only, never auto-rebase a branch carrying `--no-ff` worker merge history.

### (6) cross-repo epics
Already 80% plumbed: `getWorktreeManager(targetProject)` (`coordinator-live.ts:343`) is memoized per repo; `ensureEpic`/`commitAndMergeToEpic` run on the per-target WM. Key the epic↔branch mapping by `(targetProject, epicId)`. An epic whose children span repos gets **one epic branch per target repo** (git cannot merge atomically across repos); land is per-repo, each independently `epic-landable`-gated and separately clicked; the epic is "landed" only when every repo's branch has landed. A single child with mixed-repo siblings is fine; what is forbidden is one branch spanning repos — detect via the distinct `targetProject` set and land per-repo (escalate if it cannot be cleanly partitioned).

### (7) what happens to `collab/integration` + existing machinery
**Retired to `collab/epic/<inbox>`, not deleted outright** (keeps the migration reversible). Per MEMORY ("every todo needs an epic," Inbox epic as default), every todo resolves to *some* epic; the synthetic Inbox epic gets its own `collab/epic/<inbox>` branch, so the old trunk becomes just another epic branch. `INTEGRATION_BRANCH` survives as the Inbox-epic base/fallback during migration and is deleted only once the Inbox-epic branch is universal. The gate's `integrationBase` (`coordinator-live.ts:837-841`) — currently `INTEGRATION_BRANCH` — becomes `epicBranchName(resolveEpicId(...))` so the per-child gate diffs the child against **its epic**, not a global trunk.

Untouched by this design: the keep-warm pool, dead-worker reaping (`reapDeadPoolSlots`), per-child worktrees, node_modules symlinking, and lane teardown. We keep per-child worktrees deliberately — they preserve intra-epic parallelism and leave the pool/lane machinery alone. (A future micro-optimization: a strictly-sequential epic *could* share its integration worktree to save node_modules — not the default.)

## Epic↔Branch Storage

**Convention-derived branch name + WorktreeManager record for the path — no new todo-store column, no new table.**
- `epicBranchName(epicId)` derives `collab/epic/<id8>` from the epic id (the join key), mirroring how `tmuxBaseName`/`worker-<id8>` derive from ids and reusing `slug()`/`timestamp()` (`worktree-manager.ts:750-765`). No storage needed for the name.
- The epic worktree **path** persists as a `WorktreeInfo` record under `recordsDir()` (`:676-707`), keyed by `(targetProject, epicId)`, so resume works across daemon restarts. Reuses `readRecord`/`writeRecord`/`list`.
- The epic *identity* already exists end-to-end: `parentId` links children, `isEpicTitle` (`[EPIC]` convention) identifies roots. The `parentId` graph is the authoritative join; no schema change.
- The `Collab-Epic`/`Collab-Todo` git trailers make epic membership recoverable from history (`git log --grep='Collab-Epic: <id>'`) if the WM record is lost — defense-in-depth, zero runtime cost.

## The Land Proof-Gate Predicate

Extend `steward-proof.ts`. Add to `StewardVerb` the verb `land_epic` (currently only `reset_todo | override_accept_todo`). Add `ProofKind` `{ kind: 'epic-landable'; epicId: string; epicBranch: string }`. The runner re-derives three predicates from ground truth, never an LLM boolean — mirroring `dep-done` + `override-clean`:

1. **Store truth** — every child of `epicId` is `status === 'done' && acceptanceStatus === 'accepted'` (mirrors the `dep-done` store loop at `:133-141` and the roll-up predicate).
2. **Green** — `tscClean` run **in the epic worktree** (mirrors `override-clean` at `:151-157`).
3. **Mergeable** — a dry `git merge --no-commit --no-ff collab/epic/<id8>` **in a master checkout**, then `git merge --abort` (new runner `epicMergeClean`, reusing the `commitsBehindMaster` exec shape at `:77`).

All three green → LAND offered (surfaced); the human click re-derives all three before merging. Any red → surfaced as a blocked card. Absence of proof = hand to human.

**Critical real-stack seam (called out by the judge):** `ProofRunners.tscClean` / `commitsBehindMaster` today run with `cwd: project` (the MAIN repo) and hardcode `'master'`. Landing an epic needs tsc run in the **epic worktree** and the dry-merge run in a **master checkout** — neither is the main repo cwd. So `ProofRunners` must gain an explicit **worktree-cwd parameter** (e.g. `tscClean(cwd)`, `epicMergeClean(masterCwd, epicBranch)`). Build this seam explicitly; do not assume `cwd: project`.

## Technical Plan

### `src/agent/worktree-manager.ts`
**NEW**
- `epicBranchName(epicId: string): string` → `collab/epic/${id8}` (reuse `slug()`/id-8 convention `:750-765`).
- `ensureEpic(epicId: string, project?: string, baseRef = 'master'): Promise<EpicWorktree | null>` — clone of `ensureIntegration` (`:541-587`), parametrized branch + `__epic-<id8>__` path; create-or-resume shape; node_modules symlink; persist `WorktreeInfo` keyed by `(project, epicId)`.
- `commitAndMergeToEpic(sessionId, epicId, opts): Promise<MergeBackResult>` — clone of `commitAndMergeToIntegration` (`:596`), swap target at `:605` to `ensureEpic(epicId)`; inject `Collab-Epic`/`Collab-Todo` trailers into the merge message.
- `landEpicToMaster(epicId, opts): Promise<LandResult>` — master-checkout worktree (`__master__`-style), `git merge --no-ff collab/epic/<id8>`, abort-on-conflict (`:639-660` shape).
- `removeEpic(epicId, project?)` — `git worktree remove __epic-<id8>__` + `git branch -d collab/epic/<id8>` + delete WM record; gated on land success.

**CHANGED / RENAMED (types)**
- `IntegrationWorktree` → `EpicWorktree { epicId; branch; path }` (`:38-41`).
- `MergeBackResult.integrationBranch` → `epicBranch` (`:43-53`); add `mergeSha`.
- New `LandResult { landed; conflict; masterSha? }`.

**DEMOTED (not deleted yet)**
- `INTEGRATION_BRANCH` (`:36`) → Inbox-epic base/fallback during migration.
- `ensureIntegration()` → kept as the Inbox-epic provisioner (or thin wrapper over `ensureEpic(INBOX_EPIC_ID)`).

### `src/services/coordinator-live.ts`
**NEW**
- `resolveEpicId(todo, project): Promise<string>` — walk `parentId` to the `[EPIC]` root via `getTodo`; Inbox-epic fallback.
- `landEpic(epicId)` — the inbox LAND-click handler: re-derive `validateStewardProof('land_epic', ...)` → on green `landEpicToMaster` (behind the per-project land mutex) → `removeEpic` + resolve escalation; on conflict re-surface.

**CHANGED**
- `launchWorker` (`:542-553`): resolve epicId; `await wm.ensureEpic(epicId, targetProject)`; pass `epic.branch` as `ensure`'s `baseBranch`.
- merge-back block (`:393-423`): `wm.commitAndMergeToEpic(session, epicId, {message})`; then for each `r.rolledUp` epic, `validateStewardProof('land_epic', ...)` → `escalation_create('epic-ready-to-land', ...)`. **Do NOT merge to master here.**
- gate base (`:837-841`): `integrationBase = epicBranchName(resolveEpicId(...))`.

### `src/services/steward-proof.ts`
- Add `land_epic` to `StewardVerb`.
- Add `ProofKind` `{ kind: 'epic-landable'; epicId; epicBranch }` (`:30`).
- Add `ProofRunners.epicMergeClean(masterCwd, epicBranch): boolean` (`:60`); **parametrize `tscClean`/`commitsBehindMaster` with a worktree cwd** instead of hardcoded `cwd: project` / `'master'`.
- Handle `epic-landable` in `validateStewardProof` (`:113`): store dep-done loop + `tscClean(epicWorktree)` + `epicMergeClean(masterCheckout, epicBranch)`.

### Reuse vs New vs Delete
- **REUSE unchanged:** `EnsureOpts.baseBranch` seam, per-child worktrees, node_modules symlinking, keep-warm pool, `reapDeadPoolSlots`, lane teardown, `getWorktreeManager` per-repo memoization, the `--no-ff` abort-on-conflict merge shape, the `validateStewardProof`/`ProofRunners` framework, the roll-up loop, `escalation_create`.
- **NEW:** `epicBranchName`, `ensureEpic`, `commitAndMergeToEpic` (thin), `landEpicToMaster`, `removeEpic`, `resolveEpicId`, `landEpic` click handler, `epic-landable` proof + `epicMergeClean` runner + worktree-cwd parameter on runners, per-project land mutex, staleness surface, `Collab-Epic`/`Collab-Todo` trailers, the `epic-ready-to-land` inbox card.
- **DELETE (deferred):** `INTEGRATION_BRANCH` as a live runtime trunk — only after the Inbox-epic branch is universal.

### Phased Build Order
1. **Parametrize, no behavior change.** Add `epicBranchName`/`ensureEpic`/`commitAndMergeToEpic`; make the Inbox-epic the single epic so behavior == today's one integration branch. Ship — `collab/integration` is now `collab/epic/<inbox>`. De-risks the rename.
2. **Real per-epic branches.** Wire `resolveEpicId` into `launchWorker` + merge-back so each `[EPIC]` gets its own branch off master; fix the gate `integrationBase`. Children accumulate per-epic; land still manual. Add the `Collab-Epic` trailers here.
3. **Proof + inbox surface (read-only).** Add `land_epic` verb, the `epic-landable` predicate, the worktree-cwd runner seam, and `epicMergeClean`. On roll-up, surface `epic-ready-to-land`. No master mutation yet.
4. **The land click.** Add `landEpicToMaster` + `removeEpic` + the `landEpic` handler + per-project land mutex; wire the inbox LAND button. End-to-end, human-gated.
5. **Hardening.** Staleness surface; cross-repo per-target-repo land + multi-click land state; retire `INTEGRATION_BRANCH` behind the universal Inbox-epic.

## Why This Over the Alternatives

- **vs stacked-on-integration:** stacking keeps a shared frontier but reintroduces a per-land **restack**, and rebasing a branch that carries `--no-ff` worker merge history is the single ugliest, most lossy operation in the option set — it couples epics that are meant to be independent. Off-master avoids it entirely.
- **vs commit-range cherry-pick:** zero new branches is appealing, but `cherry-pick -m1` replay of interleaved merge commits onto clean master is the most fragile land path; hidden cross-epic deps manifest as hard-to-reason replay conflicts, and `-m1` discards the second-parent provenance the proof gate's `HEAD..master` reasoning depends on.
- **vs epic-shared-worktree:** elegant tier-deletion, but it tears out load-bearing keep-warm/pool/lane machinery (epic-keyed slots, `claimGuard` sibling-exclusion) and forfeits **all** intra-epic parallelism — a long child blocks every sibling. Too much disruption for too little gain.
- **vs FBPE's own auto-land:** we graft the **human-gated land** from planner-declared-release-train instead, because master is asymmetric (deployed, hand-rolled-back). Everything below master stays autonomous; only the publish act is a human click with the proof as decision-aid.

## Top Risks + Mitigations

1. **Hidden cross-epic textual dependency** (epic blind to sibling's accepted work until land). → Dry-merge probe in `epic-landable` catches it before touching master; surfaces as "needs human rebase," never silent.
2. **`ProofRunners` cwd assumption** (hardcoded `cwd: project` / `'master'`). → Explicit worktree-cwd parameter on `tscClean`/`epicMergeClean`; build this seam first in Phase 3, it is the most likely place to silently land against the wrong tree.
3. **Stale never-finishing epic** drifting from master. → Staleness surface flags only; never auto-rebase a branch with worker merge history.
4. **Concurrent-land races.** → Per-project land mutex; serialize epic→master, second epic re-derives against new master.
5. **Cross-repo epic mis-merge.** → Detect distinct `targetProject` set; one branch per repo; per-repo gated land; escalate if not cleanly partitionable.
6. **Migration regression.** → Phase 1 makes Inbox-epic == today's single branch before any sharding; `INTEGRATION_BRANCH` demoted not deleted, keeping rollback trivial.
