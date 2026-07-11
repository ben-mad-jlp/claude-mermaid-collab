# Grok v3 review — pure JSON with manifest

Third adversarial review. Grok refused to validate v3 and landed an important architectural insight in the closing paragraphs: **we're committing derived data to git, and that's the root of the file-count problem**. The real fix isn't picking between SQLite and JSON — it's separating what humans care about (prose) from what machines rebuild (structure, indexes).

**Cost:** ~$0.18.

**Grok's verdict:** *"Ship this and it will break in production within days."*

---

## Grok's specific hits

### Manifest atomicity
> Debouncing to 500 ms is insufficient. chokidar on a save-all or large rename/refactor can emit 100+ events in <200 ms; you will drop updates or thrash `_manifest.json` writes. More critically, there is no atomic multi-file commit. A crash, OOM, or power loss between the last `writeRecord()` and the manifest rewrite leaves the manifest pointing at stale or missing per-file JSONs. Your "source of truth" becomes a lie.

> Read-while-write is also unsolved. POSIX `rename` is atomic per inode, but nothing prevents a reader from opening the old `_manifest.json` fd before the directory update is visible.

### minisearch reality
> I have used it in production. The "2-5 MB" claim is optimistic for 3000 documents that contain full prose, method bodies, and call sites; real indexes are 8-14 MB. Deserialization + index rebuild from the serialized form is 120-250 ms cold on typical laptops, not 50-100 ms. Incremental updates exist but are expensive (remove + re-add rebuilds internal maps); you will end up rebuilding the entire index on every non-trivial change anyway.

> Tokenizer is naive for code. Symbol-heavy identifiers, JSDoc tags, and template literals produce terrible term splitting.

### Advisory lockfile
> `openSync(..., 'wx')` is not a reliable lock across Node/Bun versions or filesystems. On NFS, WSL2, or certain macOS network mounts it fails. The PID + mtime stale detection has the classic thundering-herd bug: two processes can both decide the lock is stale, both succeed on the next `openSync`, and both write.

### Drift-check-once-per-session
> A long-lived process (hours) will serve increasingly stale data after the single drift check. Background `runIncrementalScan` does not update the in-memory manifest atomically for readers that already loaded it.

> `git ls-files` is fatal: new untracked files are invisible. The mtime + `source_hash` filter also misses in-place edits that preserve mtime (common with some editors, `rsync`, `cp`).

### Quarantine
> 24 h TTL is ridiculous. A developer who goes on a three-day weekend or vacation returns to find their manual prose and LLM refinements gone. Schema validation (even with AJV) only catches structural nonsense. A parser emitting plausible but semantically wrong `method_names`, inverted `call_edges`, or shifted line numbers passes.

> No one will ever clean `.quarantine/` reliably. Gigabytes of snapshots.

### Per-file JSON git friction — the regression that matters
> 3000+ tracked JSON files makes `git status`, `git commit`, `git checkout`, and PR diffs painful. Git's index swells. Pre-commit hooks that lint or format every file become 10-30 s slower. Reviewers see 3000-file diffs when `parser_version` increments. "Gitignored by default" simply punts the problem to the first team that wants shared prose.

### Scope
> 15 days is still a lie. Concurrency edge cases, partial-write inconsistency, git-scale friction, and search quality will each take multiple weeks to stabilize.

### Single biggest risk
> Manifest/per-file desynchronization after any unclean shutdown. You have no WAL, no transaction, no checksum manifest. Production will see "why is the AI referencing a method that no longer exists" bugs constantly.

---

## The key insight Grok earned this round

> **Better architecture:** One source of truth—enriched JSON files containing *only the prose and stable metadata that should travel with the code*. All indexes (manifest, FTS, call graph) are **derived, never committed, and rebuilt on demand into memory or a transient SQLite `:memory:` DB per session**. Use a single `_index.jsonl` for the derived data so git only sees the prose files.

This is the architectural separation I kept collapsing across v1/v2/v3. I was asking "what's the storage format?" when the real question was **"what gets committed to git vs regenerated on demand?"**

### What's stable and human-valuable (COMMITTED)
- Manual prose (title, purpose, method steps written by humans or LLM)
- `prose_origin` attribution
- Per-method prose that the user curated
- Tags the user set (`@deprecated`, `@since`)

### What's rebuildable from source code (NOT COMMITTED)
- Method signatures (name, params, return_type)
- Line numbers
- `is_async`, `is_exported`
- Call edges
- Import edges
- Heuristic prose extracted from docstrings (deterministic from source)
- Source hash, mtime
- FTS index
- Manifest / cross-file index

### The payoff

A project with 3000 source files but only 30 files with manual prose commits **30 tiny JSON files, not 3000**. Git friction collapses. `parser_version` bumps don't touch committed files. PR diffs only show files where prose actually changed. The "gitignored vs tracked" open question disappears because the answer is obvious: prose is committable, derived data isn't.

**And every atomicity concern Grok raised about the manifest becomes moot**, because the derived data is disposable. If the manifest and source drift apart after a crash, you rebuild the manifest in a few seconds. There's no "source of truth" to lose because the only committed source of truth is manual prose, which is never written by a background scan.

---

## Claude's triage — v3 vs v4 architecture

### 🔴 Load-bearing hits that v4 fixes structurally

| Grok's hit | Why v4 eliminates it |
|---|---|
| Manifest atomicity after crash | Manifest is derived. Rebuild from source + prose files in 3-5s. No "source of truth" to desync. |
| chokidar burst thrashing | Derived data lives in memory or `:memory:` SQLite. Watcher updates the in-memory state; only periodically flushes to disk. No tight loop on manifest file writes. |
| Partial FTS index corruption | FTS is rebuildable from in-memory state + committed prose. Corruption just triggers rebuild on next load. |
| minisearch size (8-14 MB) | Gitignored, in-memory only. Size doesn't matter for git. |
| minisearch format churn | Rebuildable per session, no persistent format to break. |
| Advisory lockfile races | No cross-process coordination needed for derived data — each process has its own in-memory copy. Only committed prose writes (user-initiated, rare, explicit) need coordination, and those go through `pseudo_upsert_prose` which is serialized by the MCP server anyway. |
| 3000 tracked JSON files in git | Only prose-bearing files committed. Most source files have zero sidecar. |
| PR diff spam on `parser_version` bump | `parser_version` only affects derived data → nothing in git changes. |
| 24h quarantine is ridiculous | Manual prose is in git → git history IS the backup, no TTL needed. Quarantine becomes optional. |
| Pre-commit hook friction | Number of committed files is tiny (only prose-bearing) → pre-commit hooks see only the files that actually changed. |

### 🟡 Still real in v4, need fixes

| Grok's hit | v4 mitigation |
|---|---|
| Drift-check-once-per-session stale | Keep chokidar watcher always running; drift check becomes a fallback for when the watcher missed events (startup only). |
| `git ls-files` misses untracked | Combine git-ls-files with fs walk for untracked-but-not-ignored files. Small additional cost. |
| In-place edits preserving mtime | Add explicit content-hash re-check on `pseudo_rescan`; accept that passive drift check can miss these (rare). |
| Semantic parser bugs passing schema | Add a diff-sanity check: if new methods list drops > 50% of existing methods, flag as suspicious and preserve old manual prose. |
| `openSync('wx')` FS unreliability | Only needed for committed prose writes now, which go through the MCP server process — can use in-process mutex. Cross-process coordination is a non-goal. |
| 15 days is a lie | Honest revised estimate: 14 days for v4 core (less than v3 because no manifest file or FTS persistence layer to build), plus 6-8 days of polish + edge cases. Call it 18-22 days total. |

### 🟢 Still overheated

- "Production will break within days" — Grok's stock closer. This feels overstated for a single-user dev tool; v4 is simple enough that most of Grok's failure modes are theoretical.
- "NFS / WSL2 / network mounts" — still out of scope. Local dev tool.
- "SQLite's transactional guarantees we lost" — a `:memory:` SQLite per session gets them back.

---

## Proposed v4 architecture

### What lives where

```
project/
├── src/
│   ├── services/pseudo-db.ts              ← source
│   └── mcp/setup.ts
├── .collab/
│   └── pseudo/
│       ├── prose/                         ← COMMITTED tree, only files with manual/llm prose
│       │   └── src/services/pseudo-db.ts.json
│       └── .cache/                        ← GITIGNORED, rebuildable
│           ├── derived.jsonl              ← optional snapshot for faster warm start
│           ├── _runs.json                 ← scan run history
│           └── lock                       ← in-process only
└── .pseudoignore
```

**Key distinction:**
- `prose/` holds only files where a human or LLM has authored or curated prose. Small, commitable, per-branch via git, human-editable.
- `.cache/` is a single optional snapshot of derived data (structure, call edges, heuristic prose, FTS index) for faster session warm start. If missing, rebuilt in-memory from source + prose files on first session load.

### Runtime state
- Derived data lives in a `:memory:` SQLite per server process, built from source + prose tree on session start
- Rebuild is fast (~3-5s on 3000-file repo) because it's pure parse + insert, no I/O beyond reading source
- `.cache/derived.jsonl` is a performance optimization, never canonical — delete it and everything still works

### Reads
- `pseudo_get_file_state(path)` → read committed prose file (if any) + merge with in-memory structural data
- `pseudo_find_function(name)` → in-memory SQLite FTS5 query, microseconds
- `pseudo_call_chain(method)` → in-memory recursive CTE
- `pseudo_db_status()` → read in-memory aggregates
- `pseudo_import_graph(file)` → in-memory join on import_edges table

No file tree walks per call. No manifest rebuild per call. No cache reconcile. The in-memory SQLite IS the cache, and it's rebuilt atomically on server start.

### Writes
- **Background scans** (structural + heuristic) write only to in-memory SQLite. Never touch disk. Heuristic prose is regenerated from source every session — no persistence needed.
- **Manual prose writes** (`pseudo_upsert_prose`) write to the committed prose file AND update in-memory SQLite. File write is the source of truth; in-memory update is fire-and-forget cache sync (recoverable via rebuild).
- Chokidar watcher updates in-memory SQLite incrementally, no disk thrashing.

### Crash recovery
- Process dies → in-memory SQLite is lost → next start rebuilds from source + prose files in 3-5s
- Prose file corrupt → schema-validate on read, skip corrupt entries, surface in `pseudo_db_status.warnings`
- Source file deleted → structural data for it vanishes on rebuild; prose file becomes orphaned (cleaned up on scan or kept as archive)

### Concurrency
- In-process mutex on in-memory SQLite writes (cheap, no race)
- Multiple Claude Code sessions → each process has its own in-memory SQLite → no cross-process coordination needed for derived data
- Only remaining cross-process concern: two sessions both calling `pseudo_upsert_prose` on the same file → last-write-wins on the committed prose file, which is normal file concurrency behavior. If this matters, add per-file advisory locks later.

### Scope estimate
- ~14 days for v4 core (less than v3 because no persistent manifest/FTS file format to design)
- 6-8 days for polish, edge cases, Windows pathing, documentation
- Honest range: **18-22 days**. Document the uncertainty, don't pretend to a point estimate.

---

## Open questions

1. **Adopt v4?** The architecture is structurally better than v1/v2/v3 — everything Grok flagged is either fixed or becomes irrelevant. Only remaining open problems are small.
2. **`.cache/derived.jsonl` snapshot — yes or no?** Skipping it means a 3-5s rebuild on every session start. Including it saves the rebuild but adds a consistency-check-on-load problem. My lean: **skip it for v4, add it later if session-start latency is a real problem.**
3. **`:memory:` SQLite vs hand-rolled JS data structures?** `:memory:` SQLite gives us FTS5, recursive CTEs, and transactions for ~2MB of binary dependency. JS data structures would be simpler but lose FTS and graph queries. My lean: **`:memory:` SQLite**. Same bun:sqlite code path the plugin already uses, no new dependency.

---

## Sources
- Design doc under review: `design-pseudo-db-initial-population` v3
- Prior reviews: `grok-review-pseudo-db-design`, `grok-review-pseudo-db-design-v2`
- Grok call: `grok-4.20-reasoning`, ~$0.18
