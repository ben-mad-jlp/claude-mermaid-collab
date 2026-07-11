# Bug Review — Pseudo DB v6

Scope: uncommitted changes implementing pseudo-db v6. Includes both tracked edits (pseudo-db.ts, source-scanner.ts, mcp/setup.ts, plugin.json, skills/pseudocode/SKILL.md) and untracked new files under src/services/pseudo-*.ts, src/mcp/tools/pseudo-*.ts, and tests.

---

## Critical

### C1. Watcher and drift checker never started (pseudo-db.ts v6 factory)
File: src/services/pseudo-db.ts, `initPseudoDbV6` (around lines 1195-1217)

```ts
if (attachDrift) {
  try { driftChecker = createDriftChecker(project, db, indexer); } catch ...
}
if (attachWatcher) {
  try { watcher = createPseudoWatcher(project, indexer); } catch ...
}
```

Neither `driftChecker.start()` nor `watcher.start()` is ever invoked. Both `DriftChecker` and `PseudoWatcher` are start/stop objects; constructors do not begin watching. Consequence: no file-watcher-driven incremental scans, no periodic drift stat checks, no idle hash-sample checks. The v6 cold-scan runs once via `ready` and the DB then goes stale forever in a running process.

Fix: inside the `ready` IIFE (or after construction), call `driftChecker?.start()` and `await watcher?.start()`.

### C2. `handle.ready` resolves before scan completes
File: src/services/pseudo-db.ts, `initPseudoDbV6` ready IIFE (around lines 1260-1290)

```ts
handle.ready = (async () => {
  handle._state = 'warm-loading';
  // ... warm-load attempt ...
  handle._scanInFlight = (async () => {
    try { await indexer.runFullScan(...); handle._state = 'ready'; ... }
    catch ... finally { handle._scanInFlight = null; }
  })();   // <-- assigned but NOT awaited
})();
```

The outer IIFE that becomes `handle.ready` starts the inner scan promise and immediately returns. Callers doing `await handle.ready` will proceed while `_state` is still `warm-loading` / `cold-scanning` and the in-memory DB is empty. Every downstream caller that assumes "await ready = DB is ready" will read an empty database. Combined with C1, nothing else ever re-runs the scan.

Fix: await the inner promise before the outer one resolves, e.g. `handle._scanInFlight = scan; await scan.catch(() => {});`.

### C3. Warm-load snapshot validation always rejected
File: src/services/pseudo-db.ts, `initPseudoDbV6` ready IIFE

```ts
const validation = await validateSnapshotV6(snapPath, 0, new Map());
```

`validateSnapshot` in src/services/pseudo-snapshot.ts computes `lower = floor(0*0.95)=0`, `upper = ceil(0*1.05)=0`, and rejects any snapshot whose `files` row count is `> 0`. The empty `sampleFiles` map also makes the content-hash sanity check a no-op. Net effect: the warm-load path is dead code and every startup pays the full cold-scan cost.

Fix: enumerate files (e.g. via `git ls-files`) and build a small `(path, source_hash)` sample before validating, or persist a side-manifest alongside the snapshot with the expected count + sample hashes.

---

## Important

### I1. Drift checker `stop()` does not await in-flight work
File: src/services/pseudo-drift.ts, `stop()` (around lines 192-201) and `checkNow`

`stop()` clears timers but does not track or await any in-flight `checkNow`/`runIncrementalScanForFile` call. The v6 `dispose()` does `this.drift?.stop()` and then `db.close()` synchronously (line 1246 in pseudo-db.ts). If a periodic `stat` check is mid-reindex when `dispose()` fires, the drift-triggered incremental scan will be writing to a DB that then gets closed, producing obscure "database is closed" errors.

Fix: track the in-flight promise in a field and await it in `stop()` (or expose `stopAsync()` and have `dispose()` await it).

### I2. `idleTimer` is never `unref()`'d — keeps process alive
File: src/services/pseudo-drift.ts `start()` (lines 179-190) and `armIdleTimer` (lines 163-172)

`periodicTimer` is unref'd but `idleTimer` is not, and `armIdleTimer()` re-arms in `.finally` without calling `.unref?.()`. In tests or short-running scripts this holds the event loop open for up to `idleCheckMs` (default 30s), and re-arms indefinitely.

Fix: call `.unref?.()` on every `setTimeout` returned inside `armIdleTimer`.

### I3. Watcher: in-flight flush not awaited in `stop()`
File: src/services/pseudo-watcher.ts `stop()` (lines 152-165)

`stop()` clears the debounce timer and `.close()`s chokidar, but if `flush()` has already started and is awaiting `indexer.runIncrementalScan`, nothing tracks that promise. The v6 factory `dispose()` does `await this.watcher?.stop()` then `db.close()`, so an in-flight incremental scan may continue hitting a DB that's about to close.

Fix: store the current `flush()` promise in a field and `await` it from `stop()`.

### I4. Overlay step 6 picks `candidates[0]` without skipping already-claimed rows
File: src/services/pseudo-overlay.ts `step6FingerprintGlobal` (lines 108-113)

```ts
const candidates = idx.byFingerprint.get(prose.body_fingerprint);
if (!candidates || candidates.length === 0) return null;
return candidates[0]!;
```

When multiple source methods share a body fingerprint (trivial stubs, auto-generated code), step 6 always returns index 0. The outer loop then sees `claimed.has(row.id)` for the second prose targeting the same fingerprint and falls through to orphan, even though `candidates[1..]` are legitimate fresh targets.

Fix: in step 6 (and for consistency step 5), iterate and return the first candidate not in `claimed`. This requires passing `claimed` down or returning the full bucket and letting the caller pick.

### I5. `runFullScan` wipes tables outside a transaction
File: src/services/pseudo-indexer.ts `runFullScan` (lines 475-495)

```ts
db.exec(`DELETE FROM overlay_matches`);
...
db.exec(`DELETE FROM files`);
clearFts(db);
// then incremental inserts throughout the walk
```

Each `db.exec` is auto-committed. Any query that hits the in-memory DB between the deletes and the final insert sees a mid-scan inconsistent snapshot (empty files, partial methods). Incremental scans have the same property (M3).

Fix: wrap the reconcile phase in `db.transaction(() => { ... })`.

### I6. Prepared statements created per file inside `scanOneFile`
File: src/services/pseudo-indexer.ts `scanOneFile` (lines 205-216, 280-283)

`db.prepare(...)` is called inside the per-file loop for `insertMethod`, `insertStep`, `insertCall`, and `insertImport`. Across a full scan this creates thousands of statement handles. Not a correctness bug, but pointlessly wasteful; hoist the prepares to indexer scope.

### I7. `pseudo-migration.ts` mixes absolute/relative `file_path` in emitted prose files
File: src/services/pseudo-migration.ts lines 106-189

Line 110 resolves `absSource` only for the scanner read:
```ts
const absSource = isAbsolute(fr.file_path) ? fr.file_path : join(project, fr.file_path);
```
But the emitted `ProseFileV3.file` field (line 179) is left as `fr.file_path` — whatever the legacy DB stored. The v6 indexer stores `absPath`, so the overlay's `byFile.get(normPath(proseFile.file))` lookup will miss any relative entries and they'll all orphan-fallback.

Fix: normalize `fr.file_path` to absolute before assigning to `v3.file` (and before `escapePath`, if escape expects a canonical form).

### I8. `.pseudoignore` glob compiler mishandles `**`, anchored `/`, and `dirOnly`
File: src/services/source-scanner.ts `loadPseudoIgnore` (around lines 1050-1070)

```ts
const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
const re = new RegExp(`(^|/)${escaped}($|/)`);
```

- `**` becomes `[^/]*[^/]*`, still bounded to one segment, so `build/**` never matches nested files.
- Leading `/` (anchored-to-root patterns like `/dist`) is never stripped, so those patterns produce regexes that can't match.
- `dirOnly` is computed but never consulted when matching.

Users relying on `.pseudoignore` will silently get wrong ignores.

Fix: implement `**` → `.*`, strip/record leading `/` as root anchor, and either enforce `dirOnly` for directory-only matches or drop the flag. Alternatively pull in the `ignore` npm package.

---

## Minor

### M1. `insertScanRun` redundant Number conversion
File: src/services/pseudo-indexer.ts lines 423-424

```ts
return typeof lid === 'bigint' ? Number(lid) : Number(lid);
```

Both branches do the same thing. Cosmetic only.

### M2. `sanitizeFtsQuery` false-positive on `OR`/`AND`/`NOT`/`NEAR`
File: src/services/pseudo-fts.ts line 85

```ts
if (/[:()*]|\b(AND|OR|NOT|NEAR)\b/.test(trimmed)) return trimmed;
```

A plain-English query like `red OR blue` is treated as FTS operator syntax and passed through unquoted. Won't crash but produces surprising results.

Fix: gate operator syntax behind an explicit opt-in flag.

### M3. Incremental scan not transactional (parallel to I5)
File: src/services/pseudo-indexer.ts `runIncrementalScan` (lines 533-594)

Same issue as I5: no `db.transaction(...)` wrapper around the delete+insert phase, so mid-loop aborts leave partial state.

### M4. Line-count counts `0x0a` only
File: src/services/pseudo-indexer.ts lines 141-143

CRLF files work because `\r\n` contains `\n`. Classic Mac `\r`-only files count as 1 line. Essentially obsolete but noted for completeness.

### M5. `gitListFiles` stderr accumulator has no cap
File: src/services/source-scanner.ts around lines 988-991

`stderr` accumulates unbounded. Bound it to, say, 64 KB.

### M6. Plugin `SessionStart` hook touches a global marker under `$HOME`
File: .claude-plugin/plugin.json

```json
"command": "mkdir -p \"${HOME}/.claude-mermaid-collab\" && touch \"${HOME}/.claude-mermaid-collab/pseudo-rescan-incremental.marker\""
```

A per-project `SessionStart` writes to a cross-project location. Two projects that start concurrently both touch the same marker; if the consumer reads it as "a project needs rescan", project identity is lost. Not strictly a bug without seeing the consumer, but if the intent is per-project, the marker belongs under `<project>/.collab/...`.

---

## Verified OK (no bug)

- `pseudo-overlay.ts` claimed-set handling for steps 1-5 is correct; only step 6 has the multi-candidate issue (I4).
- `pseudo-migration.ts` closes the legacy DB in a finally block; `.migrated` flag check short-circuits re-runs.
- `pseudo-snapshot.ts` ATTACH path escaping (single-quote doubling) is sufficient; no SQL injection via file paths.
- `pseudo-fts.ts` parameter binding uses `?` placeholders throughout; no SQL injection.
- `pseudo-indexer.ts::cancel()` is safe when no scan is in flight (abortController nullable, optional chain).
- `source-scanner.ts::walkProject` git-repo path propagates AbortError via `checkAbort()`.
- `pseudo-prose-file.ts::writeProseFile` does atomic tmp-file + fsync + rename.
- `pseudo-fts.ts` upsert/delete/clear all wrap in `db.transaction(...)`.
- `insertScanRun` bigint handling does produce a `number` (just via a redundant ternary — see M1).

---

## Summary

**3 Critical**, **8 Important**, **6 Minor**.

The critical issues are tightly coupled in the v6 factory: `ready` resolves before scanning completes (C2), warm-load validation is always rejected because it's called with `gitFileCount=0` (C3), and neither the watcher nor the drift checker is ever started because their `.start()` methods aren't called (C1). Together these mean the subsystem's entry point serves an empty database and never recovers. All three need fixing before v6 can be considered functional. The Important items (I1-I3 lifecycle, I4 overlay, I5 transaction, I7 path canonicalization) are user-visible correctness problems that will manifest on first real use.
