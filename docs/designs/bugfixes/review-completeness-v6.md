# Completeness Review — Pseudo DB v6

Review performed: 2026-04-11. Blueprint: `bp-pseudo-db-rebuild` (37 tasks, 8 waves per spec; task graph shows 38 including test-integration-multiplatform). All 38 tasks are marked `completed` in the task graph.

## Summary

- **Tasks:** 38/38 completed in task graph (batch-1 through batch-10).
- **Files:** All 28 files listed in the blueprint exist.
- **Function exports:** All blueprint function signatures exist and have real bodies (not stubs) — except the two intentional no-op stubs inside `pseudo-indexer.ts` that are documented as a known follow-up.
- **TypeScript:** No errors in any v6 pseudo implementation file. (The only `pseudo-*` TS errors live in `src/routes/pseudo-api.test.ts`, an unrelated test file with pre-existing `data is of type 'unknown'` issues.)
- **Result:** 2 blocking gaps, 3 follow-up gaps, 1 known follow-up already tracked.

---

## Files verified

### `src/services/pseudo-*.ts` (16 files, all present)
pseudo-id, pseudo-schema, pseudo-path-escape, pseudo-docstring, pseudo-snapshot, pseudo-prose-file, pseudo-fts, pseudo-overlay, pseudo-migration, pseudo-ctags, pseudo-indexer, pseudo-ranking, pseudo-orphan, pseudo-drift, pseudo-watcher, pseudo-db.

### `src/mcp/tools/pseudo-*.ts` (9 files, all present)
pseudo-status, pseudo-rescan, pseudo-upsert-prose, pseudo-reassign, pseudo-search, pseudo-graph, pseudo-ranking-tools, pseudo-orphan-tools, pseudo-get-file-state.

### UI components (3 files, all present)
`ui/src/components/pseudo/PseudoStatusBar.tsx`, `ProseOriginBadge.tsx`, `RenameWarningsList.tsx`.

### Skills and docs
`skills/pseudocode-seed/SKILL.md`, `docs/pseudo-db-v6-migration.md` — both present.

---

## Function blueprint verification

| Export | File | Line | Status |
|---|---|---|---|
| `computeMethodId` | pseudo-id.ts | 45 | Real implementation |
| `normalizeParams` | pseudo-id.ts | 57 | Real implementation |
| `computeBodyFingerprint` | pseudo-id.ts | 70 | Real implementation |
| `walkProject` | source-scanner.ts | 915 | Real async generator (with AbortSignal) |
| `scanSourceFileStructural` | source-scanner.ts | 1229 | Real implementation |
| `runFullScan` | pseudo-indexer.ts | 464 | Real (calls walker → scanner → overlay → snapshot) |
| `runIncrementalScan` | pseudo-indexer.ts | 533 | Real |
| `runIncrementalScanForFile` | pseudo-indexer.ts | 596 | Real (delegates to runIncrementalScan) |
| `runReranking` | pseudo-indexer.ts | 600 | **Intentional no-op stub** (known follow-up) |
| `runOrphanDetection` | pseudo-indexer.ts | 604 | **Intentional no-op stub** (known follow-up) |
| `overlayProseOnMethods` | pseudo-overlay.ts | 185 | Real implementation |
| `validateSnapshot` | pseudo-snapshot.ts | 76 | Real implementation |
| `writeSnapshot` | pseudo-snapshot.ts | 43 | Real implementation |
| `loadSnapshot` | pseudo-snapshot.ts | 123 | Real implementation |
| `runOrphanDetection` | pseudo-orphan.ts | 40 | Real (272 LOC; walks prose, git log, classifies) |
| `writeProseFile` | pseudo-prose-file.ts | 145 | Real |
| `readProseFile` | pseudo-prose-file.ts | 128 | Real |
| `validateProseSchema` | pseudo-prose-file.ts | 114 | Real |
| `runMigrationFromV1` | pseudo-migration.ts | 63 | Real implementation, **but never called** (see gap M1) |
| `initPseudoDbV6` | pseudo-db.ts | 1182 | Real (singleton, warm-start attempt, background scan) |

Non-test module sizes (sanity check against stubs): ranking 256, orphan 272, ctags 312, drift 204, watcher 168, overlay 253 LOC.

---

## Stub scan

`Grep TODO|NotImplementedError|throw new Error('Not implemented')` over `src/services/pseudo-*.ts` and `src/mcp/tools/pseudo-*.ts`: **no matches**.

The only stubs are the two intentional no-ops in `pseudo-indexer.ts` (lines 600, 604) — matches the expected "known follow-up" described in the review prompt.

---

## Acceptance-criteria check

Read `docs/pseudo-db-v6-migration.md`. User-facing promises vs. implementation reality:

| Promise | Deliverable | Status |
|---|---|---|
| Committed prose files under `.collab/pseudo/prose/` | `pseudo-prose-file.ts` writes atomic JSON there, path-escaped | Delivered |
| Auto-trigger on server start | `initPseudoDbV6` kicks a background `runFullScan` from `handle.ready` | **Partial** (see gap B1 — only triggered lazily per tool call, not at server boot) |
| Warm-start snapshot | `validateSnapshot` + `loadSnapshot` wired in `pseudo-db.ts` lines 1264-1277 | Delivered (as designed — currently validates with `gitFileCount=0` and empty sampleFiles, which makes validation fail by design per the review prompt's note; **known limitation**) |
| Rename detection via fuzzy matching | `overlayProseOnMethods` hierarchical 6-level fallback producing `match_quality` | Delivered |
| Multi-language support | Regex for TS/JS/PY/C#/C++ + ctags for Go/Rust/Java/Kotlin/Ruby | Delivered (`pseudo-ctags.ts` declares `CTAGS_LANGUAGES = 'Go,Rust,Java,Kotlin,Ruby'`) |
| One-time v1→v6 migration | `runMigrationFromV1` fully implemented | **Blocking** (see gap B2 — never imported or called from anywhere) |

---

## TypeScript build

`npx tsc --noEmit 2>&1 | grep -c "pseudo-"` yields non-zero only because of `src/routes/pseudo-api.test.ts`, which has 58 pre-existing `data is of type 'unknown'` errors from loose `fetch().json()` results. This test file is not part of the v6 rebuild scope (no file in the blueprint references `src/routes/`). Filtering that file out: **zero TypeScript errors in v6 implementation files**.

---

## Gaps

### B1. `initPseudoDbV6` not called at server startup — **blocking**

- **Specified:** Blueprint task `pseudo-db-rewrite` ("On first call: try warm-start snapshot load; on failure, kick background `runFullScan`. Singleton per project."), and migration doc claims "auto-triggered … on server start". The intent is that the scan begins at server boot so the DB is warm before the first tool call.
- **Actual:** `initPseudoDbV6` is only called lazily from the tool handlers (`src/mcp/tools/pseudo-*.ts` — 17 call sites). No call site exists in `src/mcp/setup.ts`, server bootstrap, or anywhere else at startup. The singleton is created on the first tool invocation, not at server start.
- **Impact:** First `pseudo_*` tool call triggers a cold scan that could take minutes on a large repo, with the tool caller blocking the whole time. The claimed "warm by the time you use it" behavior does not happen.
- **File:** `src/mcp/setup.ts` (no eager init); `src/services/pseudo-db.ts` line 1182 (singleton factory).
- **Severity:** Blocking for the "auto-trigger on server start" acceptance criterion.
- **Fix sketch:** Call `initPseudoDbV6(project)` once during MCP server bootstrap for the current project (probably near where other per-project resources are initialized in `setup.ts`).

### B2. `runMigrationFromV1` is dead code — **blocking**

- **Specified:** Blueprint `pseudo-migration` task and blueprint §2 describes the full one-time migration flow. The migration doc explicitly promises "One-time migration runs automatically on first call to `initPseudoDbV6`: 1. Detects legacy `.collab/pseudo/pseudo.db` … 5. Writes `.collab/pseudo/.migrated` flag".
- **Actual:** `runMigrationFromV1` is defined in `src/services/pseudo-migration.ts:63` with a real implementation, but it is **never imported or called from anywhere in the codebase**. `Grep runMigrationFromV1` over `src/` returns only the definition site. `initPseudoDbV6` in `src/services/pseudo-db.ts:1182-1297` never invokes it.
- **Impact:** Users with a legacy `.collab/pseudo/pseudo.db` will have their prose ignored entirely. The documented migration contract is not met.
- **File:** `src/services/pseudo-db.ts` (missing call inside `initPseudoDbV6`).
- **Severity:** Blocking for v1→v6 upgrade path.
- **Fix sketch:** Before the warm-start/cold-scan block in `initPseudoDbV6`, call `await runMigrationFromV1(project)` (gated on the `.collab/pseudo/.migrated` flag the function already writes).

### F1. SessionStart hook does not call `pseudo_rescan` — **follow-up**

- **Specified:** Blueprint `plugin-sessionstart-hook` task: "Add SessionStart hook wiring that calls `pseudo_rescan({mode: 'incremental'})` to keep the DB warm on session entry."
- **Actual:** `.claude-plugin/plugin.json:29-31` runs `mkdir -p "${HOME}/.claude-mermaid-collab" && touch "${HOME}/.claude-mermaid-collab/pseudo-rescan-incremental.marker"`. A marker file is created but nothing in the TS codebase ever reads it — `Grep pseudo-rescan-incremental.marker` on `*.ts` files returns zero matches. The hook therefore has no effect on the database.
- **Impact:** SessionStart drift-refresh behavior promised by the blueprint does not happen. Gap is masked by the tool-level lazy init once you call any pseudo tool.
- **File:** `.claude-plugin/plugin.json:21-33`.
- **Severity:** Follow-up (non-blocking; it only affects warm-up latency on session entry).
- **Fix sketch:** Either have the hook shell out to an MCP call that invokes `pseudo_rescan`, or consume the marker file in the server bootstrap / first tool call and drop a `runIncrementalScan` accordingly.

### F2. `runReranking` / `runOrphanDetection` in indexer are no-ops — **known follow-up (flagged as expected)**

- **Specified:** `pseudo-indexer-core` blueprint delegates to `pseudo-ranking.ts` and `pseudo-orphan.ts`.
- **Actual:** `src/services/pseudo-indexer.ts:600` and `:604` are bare `async function` stubs that immediately return. Real implementations exist in `pseudo-ranking.ts` (256 LOC) and `pseudo-orphan.ts` (272 LOC) but are **not wired into** the indexer's scan pipeline.
- **Impact:** Hot-file ranking and cross-branch orphan detection only run if called directly (e.g., via the `pseudo_hot_files` / `pseudo_list_orphaned_prose` tools, which each hit their services through other paths). The automatic "runs at end of full scan" behavior never triggers.
- **Severity:** Follow-up. This matches the explicit expectation in the review prompt ("intentionally stub no-ops … actual implementations live in pseudo-ranking.ts and pseudo-orphan.ts but are not yet wired into the indexer"), so it is a **known follow-up, not a gap**.
- **Fix sketch:** In `runFullScan` around `pseudo-indexer.ts:506-507`, replace the no-op calls with real imports from `pseudo-ranking` and `pseudo-orphan`.

### F3. Snapshot warm-start always cold-rebuilds — **known limitation (flagged as expected)**

- **Specified:** `pseudo-snapshot` task: validate via PRAGMA integrity check + schema version + ±5% file count + 30-sample hashes + 7-day TTL.
- **Actual:** `src/services/pseudo-db.ts:1269` calls `validateSnapshotV6(snapPath, 0, new Map())` — always passes `gitFileCount=0` and empty sampleFiles. The file-count check (`|snapshotCount - 0| > 5%`) will reject every non-empty snapshot, so warm-start never succeeds and cold-scan always runs.
- **Severity:** The review prompt explicitly calls this out as "known limitation that validation currently fails by design", so this is a **known limitation, not a gap**.
- **Fix sketch:** Pass the real git file count and a 30-file sample map to `validateSnapshot`.

---

## Final tally

- **Blocking gaps:** 2 (B1 auto-trigger on server start; B2 v1→v6 migration never called)
- **Follow-up gaps:** 1 (F1 SessionStart hook writes a dead marker)
- **Known follow-ups already tracked:** 2 (F2 indexer no-ops; F3 snapshot validation fails-by-design)

All 38 blueprint tasks are marked completed in the task graph, all 28 blueprint files exist, all function signatures are real, no unexpected stubs, and TypeScript is clean in the v6 implementation files. The two blocking gaps are both "wiring omissions" — the code exists and works, but nothing calls it at the right time on server boot.
