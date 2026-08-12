# Baseline Failure Dispositions

Record of the 7 files carried in `scripts/backend-test-baseline.json` (generated
`2026-07-30T05:20:30.369Z`, 14 failing tests total) and how each was dispositioned.

**All 7 root-caused to a stale or incorrect TEST assertion, not a defect in the code under
test.** Disposition **(A) FIX** applies to every one: the assertion was corrected to match the
shipped behaviour it was written against. No production `src/` file was changed — every edit is
inside a `__tests__/*.test.ts` file. No `SERIAL_LANE_TAG` / `isSerialLaneSource` usage was added:
none of the 7 is a genuine concurrency or isolation hazard.

## Evidence protocol

Each file below was proven with **5 consecutive green runs at gate concurrency**:

```
bun run scripts/test-backend.ts --concurrency=6 \
  src/agent/__tests__/worktree-concurrency-lock.test.ts \
  src/routes/__tests__/orchestrator-routes.test.ts \
  src/routes/__tests__/supervisor-approve-push.test.ts \
  src/services/__tests__/epic-landed-at-equivalence.test.ts \
  src/services/__tests__/gate-runner-land-parity.test.ts \
  src/services/__tests__/landed-epic-sweep-same-pass-activation.test.ts \
  src/services/__tests__/sweep-measurement.test.ts
```

| Run | Exit code | Result |
|-----|-----------|--------|
| 1 | `0` | 7/7 files passed |
| 2 | `0` | 7/7 files passed |
| 3 | `0` | 7/7 files passed |
| 4 | `0` | 7/7 files passed |
| 5 | `0` | 7/7 files passed |

All 7 files run in the same invocation, so each per-file section cites the same five exit codes.

The baseline was then regenerated with the runner's own writer (never hand-edited):

```
bun run scripts/test-backend.ts --concurrency=6 --write-baseline=scripts/backend-test-baseline.json <the 7 files>
```

`--write-baseline` records only the files that FAILED in the run (`scripts/test-backend.ts:342-348`);
with all 7 green the emitted allowed-failure set is `"files": []`. The write was filtered to the 7
files rather than run unfiltered, because an unfiltered whole-suite run inside a leaf is forbidden
(the epic base gate already runs the whole suite and is the authority on any file outside these 7).

---

## 1. `src/agent/__tests__/worktree-concurrency-lock.test.ts`

**Failing test:** `WorktreeManager — per-project worktree mutex (6bc2dc36) > serialises concurrent
mutating calls (git spawns never overlap)`

**Assertion changed:** `expect(getMax()).toBe(1)` → `expect(getMaxMutating()).toBe(1)`, with
`makeTrackingSpawn` extended to classify each spawn (`isMutatingSpawn`: `remove`, `prune`, or
`branch` + `-D`) and track `maxActiveMutating` alongside the informational `maxActive`.

**Root cause:** `makeTrackingSpawn` counted *every* spawn as one bucket. `removeEpic`
(`src/agent/worktree-manager.ts:2443`) wraps `_removeEpicInner` in `withMainCheckoutInvariant`,
whose `readMainCheckoutHead` (`src/services/main-checkout-invariant.ts:105-109`) fires 3 concurrent
read-only git spawns (`symbolic-ref`, `rev-parse`, `status`) via `Promise.all` for a single call's
before/after snapshot. That is legitimate intra-call parallelism of *read-only* probes, unrelated to
the worktree-admin mutex the test guards. `getMax()` therefore observed 3, never the cross-epic
overlap of mutating spawns it was written to measure. The mutex itself is intact — the corrected
counter observes max 1 mutating spawn in flight across 4 concurrent `removeEpic` calls.

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

## 2. `src/routes/__tests__/orchestrator-routes.test.ts`

**Failing test:** `handleOrchestratorRoutes — node-profiles > GET returns a row per node kind with
defaults + choice lists`

**Assertion changed:** `expect(bp.defaultModel).toBe('opus')` → `expect(bp.defaultModel).toBe('sonnet')`.

**Root cause:** `NODE_PROFILE.blueprint.model` is `'sonnet'`
(`src/services/leaf-node-profile.ts:75`) — a documented cost-driven demotion dated 2026-07-21, with
the rationale in the comment at `leaf-node-profile.ts:76-79`. The test still asserted the
pre-demotion default. The route is correct; the expectation was stale.

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

## 3. `src/routes/__tests__/supervisor-approve-push.test.ts`

**Failing test:** `POST /api/supervisor/approve-push > injects a stamped approval/proceed message
and returns ok`

**Assertions changed:** the four assertions against the mocked `sendTmuxKeys` capture array
(`expect(sent).toHaveLength(1)` plus three `sent[0]` matchers) were replaced with assertions on the
route's JSON response — `expect(json.text).toMatch(/proceed/i)`, `expect(json.text).toContain('✅')`,
`expect(json.text).toMatch(/^\[\d{2}:\d{2}/)`, `expect(json.sent).toBe(false)`.

**Root cause:** `deliverNudge` (`src/routes/supervisor-routes.ts:96-105`), the primitive the
`/approve-push` handler calls at `supervisor-routes.ts:1211`, was deliberately gutted: the tmux
`send-keys` DELIVERY half was removed, so it only broadcasts `supervisor_nudge` and always returns
`sent: false` (its own doc comment at lines 96-99 says so). The route still composes the stamped
text and returns it (`supervisor-routes.ts:1210-1212`), so the observable contract moved from the
retired tmux mock to the response body. The test asserted against a mock nothing calls any more.

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

## 4. `src/services/__tests__/epic-landed-at-equivalence.test.ts`

Two failing tests.

**(a) `findLandedAtDivergence — fixture-based bidirectional equivalence > divergent: epic has
landedAt set but no done land-leaf child → flagged`**

**Assertion changed:** `expect(violations).toHaveLength(1)` → `toHaveLength(0)`, and the two
follow-on assertions on `violations[0]` were dropped for this case.

**Root cause:** `findLandedAtDivergence` (`src/services/invariant-check.ts:304-315`) flags this
direction **only** when a git-ahead probe reports `ahead > 0`. Post-cutover (mission 48e1a624, doc
comment at `invariant-check.ts:278-280`) land leaves are no longer minted, so `landedAt` alone
satisfies the invariant. The test calls the function with no `aheadOf` lookup, so `ahead` defaults
to `0` (`invariant-check.ts:306`) and — correctly — nothing is flagged.

**(b) `findLandedAtDivergence — live-store sweep > 5 fixture shapes created for real → zero
divergence`**

**Assertion changed:** none — `expect(violations).toEqual([])` is kept. The *fixture* was fixed:
after creating the `missionEpic` and `rootEpic` shapes, the test now calls
`stampEpicLandedAt(project, missionEpic.id, ...)` and `stampEpicLandedAt(project, rootEpic.id, ...)`
directly, mirroring the real dual-write call sites, instead of relying on a reopen-triggered
backfill.

**Root cause:** the test expected `_closeProject` + re-read to re-trigger the `landedAt` backfill.
It does not: `completeTodo` never dual-writes `landedAt` when a `[LAND]` leaf completes
(`stampEpicLandedAt`, `src/services/todo-store.ts:1733`, is called from the coordinator's stamp
sites), and the one-shot `user_version`-gated backfill `backfillLandedAtAndGateV8`
(`src/services/todo-store.ts:1090`) had already run when the DB was first opened — before the two
landed-epic fixtures existed. The two epics therefore had a done `[LAND]` child and a null
`landedAt`, producing 2 genuine divergences from a fixture that never performed the dual write.

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

## 5. `src/services/__tests__/gate-runner-land-parity.test.ts`

**Failing tests (5):** the whole
`gate-runner-land-parity: Class (b) — impactedSuiteGatePlugin applies when tests declared` block —
`impactedSuiteGatePlugin.appliesTo returns true when test lanes exist`, `plugin with no test lanes
in change-set → passed (abstain)`, `Class (b): impactedSuiteGatePlugin runs when test lanes declared
and change-set empty`, `Class (b): net-new failing test in impacted consumer spec → REJECTED`, and
`Class (b): baseline-present failure (not net-new) → PASSED (inherited)`.

**Assertion changed:** none — the *fixture* was fixed. All 5 occurrences of
`match: /.*\.test\.ts$/` (lines 121, 153, 201, 256, 343) became the string `match: '.*\\.test\\.ts$'`.

**Root cause:** `normalizeLanes` (`src/services/leaf-gate.ts:172`) requires `match` to be a
`string` — a `RegExp` literal fails its `typeof match !== 'string'` validation, so `resolveLeafGate`
returned `null` and every downstream `impactedSuiteGatePlugin` assertion
(`src/services/gate-runner.ts:634-822`) cascaded to failure from an invalid gate config, not from a
gate defect.

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

## 6. `src/services/__tests__/landed-epic-sweep-same-pass-activation.test.ts`

**Failing tests (3):** `runLandedEpicSweep: same-pass mission activation > a queued approved mission
is promoted and active within one sweep call`, `runLandedEpicSweep: two-run idempotence > second
sweep pass is a no-op and the landed-at divergence check stays clean`, and `runLandedEpicSweep:
approval gate > an unapproved queued mission is never promoted and stays inactive`.

**Assertion changed:** none — all 3 aborted in shared setup. `seedMissionA` was reordered to create
the `[LAND]` leaf with `status: 'todo'` **before** `completeTodo(project, epic.id, 'accepted')`,
then stamp `landedAt` and re-fetch the epic via `getTodo` — the exact pattern the sibling file
`landed-epic-sweep.test.ts:43-49` already uses.

**Root cause:** `seedMissionA` created the `[LAND]` leaf with `status: 'ready'` *after*
`completeTodo` marked the epic `done`. `createTodo`
(`src/services/todo-store.ts:2088-2131`) throws `TerminalParentApproveError`
(`todo-store.ts:2130`, guard `hasTerminalEpicAncestor` at `todo-store.ts:2174`) for an approved
(`status: 'ready'`) child under a terminal epic, so all 3 tests threw in setup and
`runLandedEpicSweep` was never exercised. The guard is correct; the seed violated it.

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

## 7. `src/services/__tests__/sweep-measurement.test.ts`

**Failing test:** `runSweepMeasurement > composes promotion, landed-at divergence, GC, and
queue-starvation over a seeded fixture, and is idempotent on replay`

**Assertion changed:** none — `expect(run1.gcDeleted).toContain(gBranch)` is kept. The *fixture* was
fixed: `gEpic` is now driven terminal before `runSweepMeasurement` — a `[LAND]` leaf is created
under it and completed, the epic is completed `accepted`, and `stampEpicLandedAt` is called so the
now-done land leaf contributes no landed-at divergence of its own (keeping
`run1.landedAtDivergence.count === 1` for `dEpic`).

**Root cause:** `gEpic` was created with `status: 'planned'` and never transitioned terminal.
`gcEpicBranches` (`src/services/landed-epic-sweep.ts:328`) carries a live-epic guard —
`if (e.status !== 'done' && e.status !== 'dropped') { skipped++; continue; }` — that deliberately
never GCs a non-terminal epic's branch no matter how fully-on-master the git probe says it is
(deleting one yanks the base out from under in-flight leaves; the comment at
`landed-epic-sweep.ts:320-327` cites the observed 2026-07-22 incidents). The test's own comment
("no land leaf, GC acts purely on the probe") was the stale assumption; the branch status is read
from the epic's own `status` column (`src/services/epic-branch-status.ts:199`).

**Green runs:** exit `0`, `0`, `0`, `0`, `0`.

---

## Out of scope

- The other ~68-75 quarantine files outside this baseline's 7 are untouched.
- No non-test `src/` production file was edited; the `outOfScope` modules named in the leaf
  blueprint (`gate-runner.ts`, `leaf-gate.ts`, `invariant-check.ts`, `landed-epic-sweep.ts`,
  `todo-store.ts`, `supervisor-routes.ts`, `leaf-node-profile.ts`, `worktree-manager.ts`,
  `main-checkout-invariant.ts`, `nested-runner-lane.ts`) are cited as evidence only.
