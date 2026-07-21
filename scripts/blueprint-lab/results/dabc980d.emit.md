I have everything I need. All dependency symbols exist on HEAD (the epic worktree), and master already carries the reference implementation of this exact primitive — so this leaf recreates it on the epic branch, grounded on symbols that are all present.

## Implementation Blueprint — Composed convergence+land sweep measurement primitive

### Context / why this leaf exists
The epic branch `ea65551e` (current HEAD) lacks `src/services/sweep-measurement.ts`; master already carries the reference (`git show master:src/services/sweep-measurement.ts`). This leaf's job is to **create that one source file** on the epic branch: a single force-run primitive that composes the mission-queue promotion, landed-at divergence check, epic-branch GC, a post-GC re-probe, and a queue-starvation check into one structured, diffable snapshot. Sibling leaves (already landed on master) supply the unit test `src/services/__tests__/sweep-measurement.test.ts` and the live-evidence harness `scripts/landed-epic-sweep-live-evidence.ts` — **both are out of scope here.**

### The one file to create
`src/services/sweep-measurement.ts` (new). No existing files are edited.

### Exact change shape
Export three symbols and follow the injectable-seam pattern from `landed-epic-sweep.ts` (`probe`/`runner`/`baseRef` all injectable, defaulting to the real `makeGitProbe(project)` / `makeBranchGcRunner(project)` / `'master'`).

**Imports (all verified present on HEAD):**
- `listTodos` from `./todo-store.js`
- `type GitProbe`, `buildEpicBranchStatus`, `makeGitProbe`, `epicBranchName` from `./epic-branch-status.js` (`epic-branch-status.ts:40,90,99,180`)
- `findLandedAtDivergence`, `type AheadLookup` from `./invariant-check.js` (`invariant-check.ts:150,159`)
- `gcEpicBranches`, `makeBranchGcRunner`, `type BranchGcRunner`, `type GcEpicBranchesResult` from `./landed-epic-sweep.js` (`landed-epic-sweep.ts:112,144` + result iface at `:94`)
- `promoteQueuedMissions`, `listMissions`, `sessionHasActiveMission`, `isMissionTerminal`, `type MissionSummary` from `./mission-store.js` (`mission-store.ts:562,1117,636,42,1087`)

**`interface SweepMeasurement`** — the structured snapshot:
```
project: string
promoted: string[]
landedAtDivergence: { count: number; ids: string[] }
gcDeleted: string[]
gcFlagged: string[]
fullyOnMasterBranchesRemaining: string[]
sessionsZeroActiveWithQueuedApproved: string[]
```

**`interface RunSweepMeasurementOpts`** — `{ probe?: GitProbe; runner?: BranchGcRunner; baseRef?: string }`.

**`function runSweepMeasurement(project: string, opts: RunSweepMeasurementOpts = {}): SweepMeasurement`** — force-runs 5 steps in strict dependency order, each wrapped in its own `try/catch` that fails open to an empty value (so one axis failing never aborts the snapshot):

1. **Promotion** — `promoted = promoteQueuedMissions(project)` (fail-open → `[]`). Must run first: it changes which missions are active, which step 5 reads.
2. **Landed-at divergence** — reuse `checkInvariants`'s recipe: `listTodos(project,{includeCompleted:true})` → `buildEpicBranchStatus(todos, probe, baseRef, project)` → build `Map(epicId → ahead)` → wrap as an `AheadLookup` (`(id)=>map.get(id)`) → `findLandedAtDivergence(todos, aheadOf)`; record `{ count: violations.length, ids: violations.map(v=>v.todoId) }`.
3. **Branch GC** — `gcEpicBranches(project,{probe,runner,baseRef})` (fail-open → `{deleted:[],flagged:[],skipped:0}`); surface `gcDeleted`/`gcFlagged`.
4. **Post-GC re-probe** — a *fresh* `listTodos` + `buildEpicBranchStatus` (GC in step 3 may have changed `exists`/`ahead`), then `fullyOnMasterBranchesRemaining = epics.filter(e => e.exists && (e.ahead ?? -1) === 0).map(e => epicBranchName(e.epicId))`.
5. **Queue-starvation** — group `listMissions(project)` by `ownerSession` (skip null); a session is flagged when it has an approved-queued candidate (`!m.mission.active && m.mission.awaitingApprovalSince == null && m.mission.queuePos != null && !isMissionTerminal(m.mission)`) **and** `!sessionHasActiveMission(project, session)`.

Return the assembled `SweepMeasurement`. The result must be diffable/idempotent across two consecutive calls on unchanged state (GC is the only mutation; a second pass finds the branches already gone and re-produces an equivalent snapshot).

### Grounding notes for the reviewer
- `MissionSummary.ownerSession` and `MissionRow.{active,awaitingApprovalSince,queuePos}` confirmed at `mission-store.ts:1090` and `:63,67,75`.
- `sessionHasActiveMission(project, session, excludeTodoId?)` — call with two args (`mission-store.ts:636`).
- The dependency ordering (promotion→step5, GC→re-probe) is load-bearing and must be preserved.

### Acceptance criteria (positive, citable)
1. `src/services/sweep-measurement.ts` exports `function runSweepMeasurement` taking `(project, opts?)` and returning `SweepMeasurement`.
2. Same file exports `interface SweepMeasurement` with all seven fields listed above.
3. Same file exports `interface RunSweepMeasurementOpts` with the three injectable seams (`probe`/`runner`/`baseRef`).
4. `runSweepMeasurement` calls `promoteQueuedMissions`, `findLandedAtDivergence`, and `gcEpicBranches` — the three composed sub-sweeps — each in the ordered body.
5. The queue-starvation branch calls `sessionHasActiveMission` and `isMissionTerminal` to compute `sessionsZeroActiveWithQueuedApproved`.

```json
{ "schemaVersion": 2, "estimatedFiles": 1, "estimatedTasks": 1,
  "nonEnumerableFanout": false,
  "filesToCreate": ["src/services/sweep-measurement.ts"],
  "filesToEdit": [],
  "tasks": [
    { "id": "compose-sweep-measurement", "files": ["src/services/sweep-measurement.ts"], "description": "Create runSweepMeasurement composing promotion, landed-at divergence, GC, post-GC re-probe, and queue-starvation into one injectable, idempotent SweepMeasurement snapshot." }
  ],
  "leafKind": "feature",
  "requirements": [
    { "kind": "symbol-present", "file": "src/services/sweep-measurement.ts", "symbol": "runSweepMeasurement", "description": "The composed force-run measurement primitive returning SweepMeasurement." },
    { "kind": "symbol-present", "file": "src/services/sweep-measurement.ts", "symbol": "SweepMeasurement", "description": "The structured, diffable snapshot interface with the seven measured fields." },
    { "kind": "symbol-present", "file": "src/services/sweep-measurement.ts", "symbol": "RunSweepMeasurementOpts", "description": "Injectable-seam opts (probe/runner/baseRef) mirroring landed-epic-sweep.ts." }
  ],
  "outOfScope": [
    "src/services/__tests__/sweep-measurement.test.ts (sibling leaf, already on master)",
    "scripts/landed-epic-sweep-live-evidence.ts (sibling leaf, already on master)",
    "Any orchestrator-live.ts wiring — this leaf ships only the standalone primitive",
    "Modifying convergence-breaker.ts, landed-epic-sweep.ts, mission-store.ts, or invariant-check.ts (all consumed as-is)"
  ] }
```