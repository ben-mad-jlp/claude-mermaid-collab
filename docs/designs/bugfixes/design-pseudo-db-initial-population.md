# Pseudo-DB Initial Population — Design Doc (v6)

**Status:** v6 incorporates six small fixes surfaced in Grok's v5 review, then closes the review loop. Core architectural decisions (commit only human-curated prose, regenerate everything else into `:memory:` SQLite per server process, multi-layered drift detection, warm-start snapshot) are unchanged from v5. The v6 delta is precision: deterministic method IDs, more robust body fingerprinting, stronger snapshot validation, bulk rename UX, faster orphan detection, and an honest scope estimate.

**Hard stop after v6.** The design is fundamentally sound. Residual risks are either measurable during implementation or acceptable for project scope.

## Problem

The pseudo-db stores compressed summaries of source files so Claude can reason about a codebase cheaply via `pseudo_*` MCP tools. Today it's effectively non-functional:

1. **Nothing populates it on first use** — `needsInitialScan` set in `src/services/pseudo-db.ts:334` but never read
2. **Two uncoordinated walkers** with different excludes
3. **Level 2 prose is manually filled one file at a time** via `/pseudocode`, tokens from user's session
4. **No incremental mode** — every run re-scans everything
5. **Silent language misses** — Go/Rust/Java/Kotlin/Swift/Ruby walked over
6. **Single-counter error reporting**
7. **Binary SQLite on disk** as canonical storage breaks across branch switches

## Goals / Non-goals

**Goals (V1, single implementation)**
- Zero-token first-scan, auto-fired silently on first project open
- Every file has some Level 2 prose on day one via docstring extraction (regenerated every session, never persisted)
- Fast queries — in-memory SQLite FTS5, recursive CTEs, microseconds per call
- Per-file error reporting
- `prose_origin` visible to Claude in MCP tool results
- Stable method identity that survives param changes and rename refactors without silent prose loss
- Branch-aware: git checkout preserves manual prose per-branch
- Multi-language (TS/JS/PY/C#/C/C++ via regex, Go/Rust/Java/Kotlin/Ruby via optional ctags)
- Git-blame ownership + priority in a post-scan re-ranking pass
- Live file watcher (chokidar) + periodic background drift check + idle content-hash sample
- Warm-start cache snapshot so second-and-subsequent server starts load in ~500ms instead of 9-18s
- Human-debuggable manual prose — plain JSON on disk
- Bulk operations for post-refactor cleanup

**Non-goals**
- LLM-generated prose during scan (deferred; `/pseudocode-seed` is the V2 answer)
- Tree-sitter structural upgrade
- Local embeddings sidecar
- Ollama bulk prose
- Shipped pattern library

## Architecture — the clean separation (unchanged from v4)

**Committed to git** (lives on disk, travels with code, per-branch via git):
- Files where a human or LLM has authored or curated prose
- `prose_origin` attribution
- Method-level prose steps
- User-set tags (`@deprecated`, `@since`)
- **Deterministic method IDs** (v6: computed from identity, not generated on first write)

**Regenerated every session** (lives in `:memory:` SQLite per server process):
- Method signatures, line numbers, `is_async`, `is_exported`
- Call edges, import edges
- Heuristic prose extracted from docstrings
- Source hashes, mtimes, line counts
- FTS5 index
- Aggregate statistics

### Directory layout

```
project/
├── src/
│   ├── services/pseudo-db.ts
│   └── mcp/setup.ts
├── .collab/
│   └── pseudo/
│       ├── prose/                                    ← COMMITTED, gitignorable per-project
│       │   ├── src/services/pseudo-db.ts.json
│       │   └── src/mcp/setup.ts.json
│       ├── .cache/                                   ← GITIGNORED, rebuildable
│       │   ├── derived.sqlite                        ← warm-start snapshot
│       │   └── runs.json                             ← scan run history
│       ├── .drift/                                   ← GITIGNORED, drift check state
│       │   └── last_check.json
│       └── .pseudoignore                             ← user opt-out patterns
```

## Method identity — deterministic IDs with hierarchical fallback (v6)

**v6 change:** IDs are computed deterministically from method identity, not generated on first prose write.

### The deterministic ID function

```ts
function computeMethodId(m: {
  file_path: string,
  enclosing_class: string | null,
  name: string,
  normalized_params: string
}): string {
  const key = [
    normalizePath(m.file_path),  // forward slashes, no leading ./
    m.enclosing_class ?? '',
    m.name,
    m.normalized_params          // whitespace collapsed, types only, no names
  ].join('::');
  return 'm_' + sha1(key).slice(0, 8);
}
```

**Properties:**
- Same method in the same file produces the same ID every scan (deterministic)
- No per-write ID generation, no "first write" special case
- When the cache is lost, IDs are re-derived identically — no cache is canonical for identity
- Rename method → different ID → fuzzy fallback triggers naturally
- Change params → different ID → `param_mismatch` warning
- Move file → different ID → cross-file fuzzy match

**What `normalized_params` looks like:**

```
(a: number, b: string = "x", ...rest: any[]) 
  → "number,string,any[]"
```

Strip parameter names, strip default values, keep type tokens only. Two methods with the same types but different variable names produce the same params string → same ID. This is intentional — a parameter rename shouldn't change identity.

### Committed prose file shape (v6)

```json
{
  "schema_version": 3,
  "file": "src/services/pseudo-db.ts",
  "title": "Pseudo DB — persistence layer",
  "purpose": "...",
  "module_context": "...",
  "methods": [
    {
      "id": "m_a4f3c8b1",
      "name": "getPseudoDb",
      "enclosing_class": null,
      "normalized_params": "string",
      "body_fingerprint": "h_2f9d1e44",
      "prose_origin": "manual",
      "steps": [
        { "order": 1, "content": "Look up project in instances map" },
        { "order": 2, "content": "Construct + migrate if absent" },
        { "order": 3, "content": "Return instance" }
      ],
      "tags": { "deprecated": false, "since": "2.0.0" }
    }
  ]
}
```

The `id` is redundant with `(file, enclosing_class, name, normalized_params)` but stored explicitly for:
- Fast in-memory indexing (single-key join instead of 4-key)
- Human debugging (visible stable identifier)
- Forward-compatibility if the ID function changes in the future (migration can re-sign)

### Hierarchical overlay lookup (unchanged shape from v5)

When the scanner finds a source method and needs to attach committed prose:

1. **`id` match.** Compute the source method's ID via the same function; look up in the committed-prose-id map. Hit → attach, done. **This is now the common fast path** because every method has a deterministic ID, not just ones that had prose written.
2. **`(file, enclosing_class, name)` with normalized_params tolerance.** Params changed but name and class are stable. Hit → attach, surface `param_mismatch` warning.
3. **`(file, name)` without enclosing class.** Class was renamed or methods moved between classes. Hit → attach, surface `class_mismatch` warning.
4. **`body_fingerprint` match within the same file.** Method was renamed but body is substantially unchanged. Hit → attach, surface `fuzzy_rename` warning.
5. **Cross-file `body_fingerprint` match.** Method moved between files. Hit → `fuzzy_move` warning.
6. **Unmatched.** Orphan, flagged with fuzzy-match candidates.

Every match above level 1 is recorded in the in-memory `overlay_matches` table and surfaced to Claude in tool results.

### Body fingerprint — bag-of-words (v6)

**v5 used first-32-tokens which broke under reordering.** v6 uses identifier bag-of-words:

```ts
function computeBodyFingerprint(methodBody: string): string {
  // 1. Extract identifiers only (skip keywords, literals, operators, comments)
  const identifiers = tokenize(methodBody).filter(isIdentifier);
  // 2. Keep only unique identifiers
  const unique = new Set(identifiers);
  // 3. Filter out common low-signal tokens
  const filtered = [...unique].filter(t => !STOP_WORDS.has(t));
  // 4. Sort for order-independence
  const sorted = filtered.sort();
  // 5. Join and hash
  return 'h_' + sha1(sorted.join(' ')).slice(0, 8);
}
```

**Robust against:**
- Identifier renaming (variable names change, structural identifiers preserved)
- Statement reordering
- Adding/removing logging
- Extracting a local variable
- Inlining a constant
- Adding early returns

**Sensitive to (correctly):**
- Adding new function calls
- Using different APIs
- Substantial logic changes

**False-positive risk:** two methods with identical identifier sets but different structure (rare in practice). Acceptable — fuzzy match surfaces candidates, never auto-attaches.

### `pseudo_reassign_prose` + bulk variant (v6 adds bulk)

```ts
pseudo_reassign_prose(project, {
  file: string,
  old: { name, enclosing_class?, normalized_params? },
  new: { name, enclosing_class?, normalized_params? }
}) → { reassigned: boolean, id: string }

pseudo_reassign_prose_bulk(project, {
  mappings: Array<{
    file: string,
    old: { name, enclosing_class?, normalized_params? },
    new: { name, enclosing_class?, normalized_params? }
  }>,
  confirm: boolean   // required — no accidental bulk reassigns
}) → { reassigned: number, errors: Array<{ mapping, reason }> }
```

Used when a large refactor renames dozens of methods at once. Claude can assemble the mapping from `overlay_matches` fuzzy_rename warnings and present one confirmation to the user.

## Drift detection — four layers (unchanged from v5)

- **Layer 1 chokidar:** continuous, 100ms debounced, primary fast path
- **Layer 2 periodic background:** every 5 minutes, `git ls-files` + stat, runs off-main-thread, ~200-500ms
- **Layer 3 idle-triggered:** after 30 seconds of no MCP activity (v6: tightened from 60s), content-hash 10% sample, ~500ms-1s
- **Layer 4 explicit:** `pseudo_rescan({mode: 'drift_check'})` tool

Max undetected drift window: 5 minutes. Chokidar catches 95%+ of saves in <10ms.

**Known limitations** (documented, not fixed):
- JetBrains atomic-save patterns — caught by Layer 2 within 5 minutes
- vim `backupcopy=auto` — caught by Layer 2
- WSL2 cross-boundary file changes — best-effort only
- OneDrive / cloud-sync path flakiness — emit startup warning

## In-memory SQLite — `:memory:` with warm-start snapshot (v6 tightened validation)

### Fresh cold start (no valid snapshot)

1. Open `:memory:` SQLite via `bun:sqlite`
2. Run schema init
3. Spawn background `runFullScan()`
4. At scan completion, serialize to `.cache/derived.sqlite`

Honest cold-start time: **9-18 seconds** on a 3000-file repo.

### Warm start (snapshot valid)

1. Check `.cache/derived.sqlite` exists
2. **Run `PRAGMA integrity_check` — fail-fast on corruption** (v6)
3. Validate:
   - Schema version matches current code
   - File count matches `git ls-files` count (±5% tolerance)
   - **Random 30-file source_hash sample (v6: bumped from 10) — compare against snapshot**
   - Snapshot `generated_at < 7 days ago`
4. Valid → `ATTACH DATABASE` + INSERT SELECT → ~500-800ms
5. Invalid → delete cache, fall through to cold start
6. Immediately kick off a background drift check to catch changes since snapshot

**v6 change:** added `PRAGMA integrity_check` so corrupted snapshots fail loudly instead of loading silently wrong data. Sample size increased from 10 to 30 files for stronger drift detection at warm-start.

### Snapshot serialization

```sql
ATTACH DATABASE '.collab/pseudo/.cache/derived.sqlite' AS snap;
BEGIN;
DROP TABLE IF EXISTS snap.files;
DROP TABLE IF EXISTS snap.methods;
-- ... for every table
CREATE TABLE snap.files AS SELECT * FROM main.files;
-- ... for every table
COMMIT;
DETACH DATABASE snap;
```

Simple and portable. If performance matters later, switch to bun:sqlite's native `serialize()`.

## Reads — microseconds per call (unchanged)

All MCP read tools query in-memory SQLite directly. FTS5 for text search, recursive CTEs for graph queries. Responses carry `prose_origin` and `match_quality` for every method-level prose entry.

## Writes — unchanged from v5

**Background scans** → in-memory SQLite only, never committed prose files.

**Manual prose writes** (`pseudo_upsert_prose`, required `origin` param):
1. Schema validate
2. Diff-sanity check (reject if new methods drop > 50% of existing)
3. In-process mutex on target file
4. Read existing committed prose file
5. **Compute deterministic IDs** for incoming methods (v6)
6. Preserve existing entry IDs if they match; generate fresh IDs for new entries
7. Merge
8. `writeFile(.tmp)` + `fsync` + `rename(.tmp, .json)`
9. Update in-memory SQLite (fire-and-forget)

## Orphan detection — single git pass (v6)

**v5 ran `git branch --contains` per orphaned file — slow.** v6 does one upfront pass.

```
runOrphanDetection():
  # One git call to collect "files present in any branch recently"
  recentFiles = Set(git log --all --name-only --since=30.days.ago --pretty=format:)
  
  for each committed prose file:
    source_path = derive source path from prose file path
    if source_path not in current working tree source walk:
      if source_path in recentFiles:
        status[prose] = 'cross-branch-orphan'
      else:
        status[prose] = 'orphan-candidate'
        suggestions = fuzzyMatchSameDirectory(prose, working_tree_source)
```

**Cost:** one `git log` call (~500ms on most repos) + O(n) lookup in the set. Runs once per scan, not per file.

```ts
pseudo_list_orphaned_prose(project) → {
  crossBranch: string[],
  actualOrphans: Array<{ file, suggestions: Array<{path, method, confidence}> }>
}
pseudo_cleanup_orphaned_prose(project, { files, confirm: true })
```

`confirm: true` required for safety.

## Docstring-first Level 2 pass (unchanged from v5)

Supported formats: JSDoc, TSDoc, PEP 257, C# XML doc, Doxygen. Extraction rules: first-non-empty-line → title, remaining → purpose, `@param`/`@returns`/lists → steps, tags to method tags. Attribution rules: within-2-lines, ambiguity errors.

## V1.5 — ctags + git-blame re-ranking (unchanged from v5)

ctags opt-in for Go/Rust/Java/Kotlin/Ruby with graceful fallback. Git-blame ranking pass updates in-memory priority/owner columns.

## Chokidar file watcher (unchanged)

Primary low-latency drift detection. Not authoritative — layers 2-4 catch misses.

## Size throttling (unchanged)

Files > 500 KB, > 10K lines, or binary-detected → stub records.

## MCP tool shapes

```ts
pseudo_db_status(project) → { ...v5 shape unchanged }
pseudo_rescan(project, { mode, cancel? })
pseudo_rerank(project, { cancel? })
pseudo_get_file_state(project, path)
pseudo_find_function(project, name)
pseudo_search(project, query, { filterOrigin? })
pseudo_hot_files(project, { limit })
pseudo_list_heuristic_files(project, { limit, orderBy })
pseudo_import_graph(project, file)
pseudo_call_chain(project, method, { direction, depth })
pseudo_stats_delta(project, { sinceRunId })
pseudo_team_ownership(project)

// v5 identity tools
pseudo_reassign_prose(project, { file, old, new })
pseudo_list_orphaned_prose(project)
pseudo_cleanup_orphaned_prose(project, { files, confirm })

// v6 NEW
pseudo_reassign_prose_bulk(project, { mappings, confirm: true })
```

**Breaking change:** `pseudo_upsert_prose` — required `origin: 'manual' | 'llm'` parameter.

## Migration from current SQLite state

One-time at first boot of v6:
1. Detect existing `pseudo.db` with prose data
2. For each file row with non-null title/purpose/steps:
   - Create `.collab/pseudo/prose/<path>.json`
   - **Compute deterministic IDs for each method** using the v6 ID function (v6)
   - Set `prose_origin: 'manual'`
   - Compute `body_fingerprint` from current source (bag-of-words, v6)
   - Set `enclosing_class` from source parse
3. Write atomically
4. Delete old `pseudo.db`

Time: ~5-10s per 1000 files with prose.

## Blockers fixed (cumulative across v1→v6)

- ✅ All v1-v5 items (branch switching, concurrency, origin visibility, watcher multi-layer, warm-start, orphan awareness, etc.)
- ✅ **IDs reactive on first write** — v6 makes them deterministic from identity
- ✅ **body_fingerprint fragile to reorders/logging** — v6 uses bag-of-words
- ✅ **Snapshot silently loading corrupt data** — v6 adds PRAGMA integrity_check
- ✅ **10-file sample too weak** — v6 bumps to 30
- ✅ **Orphan detection per-file git calls** — v6 does single upfront pass
- ✅ **50-orphan bulk reassign UX** — v6 adds `pseudo_reassign_prose_bulk`

## Still open (residual risks, accepted)

1. **Warm-start snapshot validation window.** 30-file sample is stronger than 10 but still not exhaustive. Background drift check catches the remainder within 5 minutes.
2. **Body fingerprint false positives.** Rare but possible. Surfaced as warnings, never auto-attached.
3. **JetBrains / vim atomic-save gap.** Caught within 5 minutes by Layer 2.
4. **Users who never go idle.** Rely on Layer 2 periodic check, miss the Layer 3 hash sample.
5. **Git friction growth over time** as committed prose files accumulate. User choice.
6. **OneDrive / WSL2 / network mounts.** Documented limitations.
7. **Windows path escaping edge cases.** Reserved-name handling + collision hash suffix; comprehensive test suite in Phase 7.
8. **bun:sqlite version upgrades** may invalidate snapshots via schema version mismatch. Fall-through to cold rebuild handles it.
9. **Long-running session memory growth.** In-memory SQLite grows as source grows. Measure on real monorepos.
10. **Periodic drift under heavy compilation load.** Fixed 5-minute interval; lowering priority during active operations is a future tuning.

## Phased implementation (single contiguous work stream)

**Phase 1 — In-memory foundation + snapshot (3 days)**
- `:memory:` SQLite schema + init with `overlay_matches`, `orphan_prose`, deterministic ID helpers
- Shared walker honoring `.gitignore` + `.pseudoignore` + untracked walk
- `pseudo-indexer.ts` with `runFullScan` / `runIncrementalScan` / `runReranking`
- Regex scanner writing to in-memory SQLite
- Snapshot serialize + deserialize with PRAGMA integrity_check
- Size throttling + binary detection
- Migration from v1 SQLite to committed prose files with deterministic id generation

**Phase 2 — Scan orchestration + status + drift layers (3 days)**
- Auto-trigger in `getPseudoDb` with retry policy
- AbortSignal plumbing
- `pseudo_db_status`, `pseudo_rescan`, `pseudo_rerank` tools
- Per-file error reporting
- Periodic background drift check (5-min)
- Idle-triggered content-hash sample (30s)
- Snapshot validation (30-file sample) + warm-start load

**Phase 3 — Docstring Level 2 + origin + identity (5 days)**
- `extractDocstringProse` for JSDoc/TSDoc/PEP 257/XML doc/Doxygen
- Attribution rules + ambiguity errors
- Deterministic ID computation + bag-of-words body fingerprint
- Hierarchical overlay lookup with match_quality surfacing
- `pseudo_reassign_prose` + `pseudo_reassign_prose_bulk` tools
- Committed prose overlay on in-memory state
- `prose_origin` in every tool result
- Breaking `pseudo_upsert_prose(origin)` change with schema + diff-sanity
- `/pseudocode` skill update for heuristic upgrade + rename detection

**Phase 4 — Multi-language + ranking + orphan detection (5 days)**
- ctags detection + complement scanner
- Git-blame re-ranking pass (single log pass for ownership)
- Team clusters
- `pseudo_hot_files`, `pseudo_list_heuristic_files`
- Single-pass orphan detection with cross-branch awareness
- `pseudo_list_orphaned_prose`, `pseudo_cleanup_orphaned_prose`

**Phase 5 — Watcher + search + graph (4 days)**
- chokidar watcher with 100ms debounced batching
- Source + prose file watching
- SessionStart hook rescan
- SQLite FTS5 wiring for `pseudo_search`
- `pseudo_import_graph`, `pseudo_call_chain`, `pseudo_stats_delta`

**Phase 6 — UI + polish + `/pseudocode-seed` (4 days)**
- Onboarding UI reads `pseudo_db_status`
- "AUTO" badge for heuristic prose
- Match-quality warnings in sidebar
- One-click reassign UI for rename candidates
- `pseudo_hot_files`-driven `/pseudocode-seed` skill
- Integration tests across multi-language sample repos
- Windows path-escape test suite
- Documentation

**Phase 7 — Integration + Windows + edge cases + testing (8-12 days)**
- Multi-platform testing on macOS/Linux/Windows
- WSL2, OneDrive, cloud-sync path behavior
- Symlinks, junction points, long paths
- Stress tests: 10k-file monorepos, bulk refactor bursts
- Identity edge cases: overloads, generics, computed method names
- Documentation + migration guide

**Honest scope range: 28-40 days.** Phases 1-6 sum to 24 days of focused work. Phase 7 (integration + Windows + edge cases) realistically eats 8-12 days — historically always underestimated. Documentation + migration polish adds 2-4 days.

**Stop pretending otherwise.** If this ships in 28 days it's a miracle; 35 days is realistic; 40 is if Windows turns nasty.

## Open questions (user decisions only)

1. **Commit prose by default?** My lean: gitignored by default, document the unignore path.
2. **Snapshot TTL:** 7 days default, make configurable.
3. **Fuzzy-rename auto-confirm threshold:** 0.95+ lean, below → warning only.
4. **Periodic drift interval:** 5 minutes default, configurable.
5. **Orphan auto-cleanup:** never auto-delete, always require explicit confirm.
6. **Deterministic ID algorithm versioning:** if the ID function changes in the future (e.g. different normalization rules), how do we migrate existing committed prose? My lean: schema_version bump + migration helper that recomputes IDs and rewrites prose files in place.

---

## Referenced code
- `src/services/pseudo-db.ts` — current schema + dead `needsInitialScan` at lines 286, 316, 334
- `src/services/source-scanner.ts` — regex scanners to refactor into shared walker
- `src/mcp/setup.ts:3771-3828` — current tool handlers
- `skills/pseudocode/SKILL.md` — manual Level 2 workflow
- `src/services/onboarding-manager.ts:92-118` — downstream consumer of pseudo state
- `.claude-plugin/plugin.json:21-30` — SessionStart hook already wired (F4 free)
- `package.json:27` — `chokidar` already a dep (F5 free)
- `bun:sqlite` — already in use, supports `:memory:`, FTS5, `ATTACH DATABASE`, `PRAGMA integrity_check`
- **No new dependencies required.**
