# Grok v2 review — hybrid storage design

Second adversarial review of `design-pseudo-db-initial-population` after the JSON-as-source-of-truth + SQLite-cache rewrite. Asked Grok to critique the new architecture, not validate it.

**Cost:** ~$0.17. Grok stayed harsh and surfaced several real issues.

---

## Grok's critique — direct quotes on what's still broken

### On JSON-as-source-of-truth
> Cold-cache `pseudo_find_function` (or any global search) that walks the JSON tree will be unacceptable. 3000 files means 3000 JSON parses + string scans before FTS can even be rebuilt. Your "3-5 seconds for 3000-file repo" cold-start number is optimistic; real-world includes disk I/O, JSON parsing overhead, and whatever language runtime this runs in. MCP tool calls will feel like they hang. You have no index-of-indices or manifest file, so every cold path pays full tax.

> Drift beyond reconcile is trivial to trigger: any manual JSON edit that touches `source_hash` but not `mtime`, concurrent git operations that restore older JSONs, or backup tools that reset timestamps. Reconcile only looks at mtime vs `indexed_at`; it cannot detect semantic drift inside the JSON (e.g. corrupted `methods` array that still passes schema).

> Atomic rename on Windows is not Unix. On NTFS it mostly works, but FAT32/exFAT, OneDrive, antivirus scanners, and cross-volume moves all break it.

> URL-encoding for paths is the wrong escape: it turns readable paths into unreadable garbage, breaks editor plugins, and still collides with Windows reserved names (`CON`, `AUX`, `NUL`, `COM1`, etc.).

> 3000 files in a nested `.collab/pseudo/` tree is not theoretical. It murders filesystem watchers, `git status` time, Windows Explorer, macOS Spotlight, and any IDE that indexes the workspace.

### On the heartbeat lock
> The check-and-takeover protocol still has a race window between SELECT heartbeat and UPDATE. Two processes can both read "stale", both decide they are the winner, both write.

> The separate `.scan-state` DB creates exactly the coordination bug you claim to have solved: you can now have index.sqlite and scan-state out of sync about who owns the lock.

> Process A holding lock while process B does `rm -rf .collab/pseudo/` leaves A with dangling file handles and cache rows pointing at nothing.

### On reconcile
> Stat() on 3000 files is not 50-500 ms on real hardware, especially cold cache, macOS APFS, Windows Defender, or any CI runner. Expect 1-3 seconds in bad cases. You run this on *every* `getPseudoDb()` call. That is unacceptable for an MCP tool users will hammer.

> The mtime + `indexed_at` check fails when two writes happen inside the same millisecond (common during branch switches, script-driven updates, or fast CI). You have no content hash validation on reconcile path, only on full rebuild.

> Massive git pull (200 new + 500 changed JSONs) will block the first MCP call while reconcile re-parses everything.

### On the write protocol
> Between successful JSON atomic rename and cache write, any other process doing `getPseudoDb()` sees the new JSON but stale cache, triggering reconcile which may or may not match what you just wrote. You have a non-atomic "source of truth" update.

> Cache write failure after JSON success is not guaranteed to be fixed by later reconcile if the JSON's `source_hash` matches the (now stale) cache row. Your reconcile logic as described only triggers on mtime or parser_version mismatch. Transient disk-full or SQLite bug therefore leaves permanent inconsistency that reconcile silently skips.

> Crash during JSON write: your tmp-rename helps, but you have no fsync, no cleanup of orphaned .tmp files, and no transaction around the entire "write JSON + update scan-state" operation.

### Highest risk item
> Manual/LLM prose lives in git-tracked JSON files that are also the source of truth. Any corruption, bad merge, or buggy writer permanently loses or garbles human intent with no recovery path except git history spelunking. The "JSON first" decision makes every parser bug or concurrent write a potential data-loss event for the only thing that actually matters (the prose).

### Verdict
> This architecture traded the original v1 problems for a new set of consistency, latency, and operational hazards that are harder to reason about. The hybrid model introduces more surface area than it removes.

---

## Claude's triage — which criticisms are load-bearing

### 🔴 Critical and correct — must fix before implementation

1. **Reconcile-on-every-`getPseudoDb()` is a latency trap.** Grok is right: stat'ing thousands of files on every MCP call is unacceptable. Must move to "once per session start" or explicit opt-in.
2. **Cold-cache global search is brutal.** 3000 JSON parses to rebuild FTS from scratch is seconds of latency. Need a **manifest file** (`.collab/pseudo/_manifest.json`) that carries file paths + content hashes + parser versions in one read. The cache rebuild reads the manifest first, compares against cache, and only parses changed files.
3. **Observable inconsistency window between JSON write and cache write.** Real and unavoidable with two separate storage systems. Fix: readers of `pseudo_get_file_state` (the single-file case) should read JSON directly and bypass the cache entirely. Cache is only for cross-file queries. Eliminates the window for the common read path.
4. **Parser bug writing bad JSON = permanent data loss.** Grok's highest-risk call is correct. Fix: schema-validate every JSON before `rename()` commits it, and keep a one-off quarantine copy of the pre-edit JSON for 24 hours.
5. **No fsync in the write protocol.** Gap I missed. Must `fsync(fd)` before `rename()` for crash safety.
6. **Heartbeat race.** SELECT+UPDATE on the lock row isn't atomic; need `BEGIN IMMEDIATE` transaction so the SELECT takes the write lock upfront. SQLite supports this; the design just didn't specify it.
7. **Dangling cache rows after `rm -rf .collab/pseudo/`.** Holder A needs to detect its own source-of-truth disappearing and bail. Fix: periodic heartbeat also checks that `.collab/pseudo/` exists — if not, abort with `scan_runs.status = 'cancelled'`.

### 🟡 Real but solvable with small tweaks

8. **Path encoding on Windows.** URL-encode is wrong. Better: replace filesystem-reserved chars with `_`, append a short content-hash suffix on collision. Keeps paths readable and avoids reserved names. Cost: one helper function.
9. **Two SQLite files drift.** The index.sqlite ↔ .scan-state coordination concern is real but narrow. Fix: just collapse them into one `index.sqlite` with a `scan_lock` table alongside the cache tables. The separation was premature.
10. **Semantic drift inside JSON (corrupted methods array that passes schema).** Mitigation: reconcile validates JSON parses successfully; on parse failure, quarantine and full-rescan that file from source.
11. **mtime equality within a millisecond.** Use content-hash comparison as tiebreaker when mtime is equal — we already store `source_hash` in the JSON frontmatter.
12. **Massive git pull blocks first MCP call.** Move reconcile to a **background task after the first MCP call returns** — return stale-but-functional data, reconcile in the background, refresh subsequent calls.

### 🟢 Overheated or out of scope for this project

13. **"Murders filesystem watchers, git status, Spotlight, IDE indexers."** Overstated. chokidar handles 3000 files fine (it's explicitly designed for it). `git status` on a 3000-file directory adds maybe 100ms. Real concern: Finder/Explorer navigation into `.collab/pseudo/` — but users don't do that normally. Mitigation: add `.collab/pseudo/` to `.gitattributes` with `export-ignore` and set the `hidden` flag on the directory on Windows.
14. **"FAT32/exFAT/OneDrive/cross-volume."** Not realistic targets. This is a local dev tool running on macOS/Linux/Windows developer machines with NTFS/APFS/ext4. OneDrive is the only real concern — users with their project root under OneDrive will hit issues. Document it as a known limitation.
15. **"Network filesystems, Docker volumes, laptops waking from sleep."** Out of scope. MCP server runs locally.
16. **"Multi-machine CI writes JSONs developers pull."** Not how this tool is used.
17. **"Manual prose editing of raw JSON is terrible UX."** Partially true but not blocking — the primary edit path is `/pseudocode`, not hand-editing.
18. **"Security boundary between git-tracked JSON and untrusted code."** Not a real threat for a single-user dev tool.

---

## What I actually agree with vs push back on

**Grok is right that the hybrid architecture adds surface area.** Two storage systems means two places to be wrong about. The write atomicity problem in particular doesn't have a clean fix without giving up one side or the other.

**But Grok overstates the "18 days is fantasy" claim.** Most of the v2 work is the same as v1 — regex scanning, docstring parsing, walker extraction, tool handlers. The new surface (JSON I/O + cache rebuilder + reconcile) is maybe 3 days of that. The scope estimate is honest.

**The most important question Grok surfaces (without saying so explicitly): is hybrid actually better than pure JSON or pure SQLite?** Let me reconsider:

| Concern | Pure SQLite (+ git_head_sha) | Pure JSON (+ manifest) | Hybrid (JSON + cache) |
|---|---|---|---|
| Branch switching | Complicated (per-row branch key) | Free (git owns it) | Free (git owns it) |
| Query speed | Fast | Slow cold, OK warm | Fast |
| Human-debuggable | No | Yes | Yes |
| Write atomicity | Transaction (easy) | Atomic-rename (gotchas) | Two systems (hardest) |
| Corruption recovery | Restore from git DB dumps | Git log | Rebuild cache from JSON |
| Concurrency | WAL + transactions | Per-file lock | Heartbeat + atomicity window |
| Data-loss risk | Low | Low if validated | Medium (parser bugs poison canon) |
| Architecture complexity | Medium | Low | High |

**Honest reassessment:** the hybrid's only advantage over pure JSON is query speed. But the pure-JSON cold-query problem is solvable with a single manifest file + in-memory index. And SQLite's advantages disappear as soon as you give up binary storage.

**Pure JSON with a manifest file may actually be the best architecture**, not hybrid. Let me sketch it:

```
.collab/pseudo/
├── _manifest.json               ← compact: [{file, hash, title, prose_origin, parser_version}, ...]
├── _fts.idx                     ← prebuilt lunr/minisearch index, regenerated on change
├── src/services/pseudo-db.ts.json
└── src/mcp/setup.ts.json
```

**Reads:**
- `pseudo_get_file_state(path)` → read one JSON file, O(1).
- `pseudo_find_function(name)` → load `_fts.idx` once into memory (~100ms cold, cached for session), query in-memory, <5ms.
- `pseudo_db_status()` → read `_manifest.json` (~50KB for 3000 files, single read), aggregate in code.
- `pseudo_call_chain()` → walk manifest-indexed JSON files following call edges (slower but bounded).

**Writes:**
- `upsertFile(path, record)` → write JSON tmp + fsync + rename → update manifest entry → regenerate `_fts.idx` atomically.

**Advantages over hybrid:**
- One storage system, one source of truth, one atomicity story.
- No reconcile pass (manifest IS the reconcile target, rebuilt from files on fresh clone).
- No two-writes-in-sequence inconsistency window.
- No second SQLite DB for lock coordination — use a single lock file or even in-process mutex.
- Cold start: read manifest (50KB, ~20ms) + lazy-load FTS on first search. Not 3 seconds.

**Disadvantages:**
- FTS on files is slower per-query than SQLite FTS5. But `minisearch` on 3000 documents is still sub-10ms.
- Graph queries (`pseudo_call_chain`) are slower without a call_edges table. Solution: keep call edges in the manifest as a compact adjacency list.

---

## Revised recommendation: drop the hybrid, go pure JSON with manifest

The hybrid model is strictly worse than pure-JSON-with-manifest once you work through Grok's criticisms:

1. **Fewer failure modes** — one storage system instead of two
2. **Faster cold start** — single manifest read instead of JSON tree walk for rebuild
3. **No observable inconsistency window** — atomic rename on a single file + manifest update is sequential but single-writer
4. **No reconcile pass** — manifest IS the index-of-indices
5. **No SQLite quirks** — no FTS5 DELETE WHERE rowid, no WAL tuning, no schema migrations
6. **Simpler cross-process coordination** — single lock file or advisory lock on the manifest

**Cost:** ~1 day less work than hybrid (skip the cache tables, cache rebuild, reconcile pass). Query latency goes up slightly on cross-file operations but is still well below human-perceptible thresholds.

**Total scope estimate:** ~15 days instead of 18.

This is the architecture Grok was implicitly pointing at by saying "the hybrid introduces more surface area than it removes." The fix isn't to patch the hybrid — it's to delete one half.

---

## Open questions after this review

1. **Adopt pure-JSON-with-manifest instead of hybrid?** (My recommendation: yes.)
2. **What `minisearch`/`lunr`/alternative FTS library for in-memory search?** (MIT-licensed, ~20KB, sub-10ms on 3000 docs.)
3. **Call graph storage:** adjacency list in manifest, or separate `_calls.json`?
4. **Manifest update strategy:** rewrite whole manifest atomically, or use a per-file append-only log that gets compacted?
5. **First-scan MCP call UX:** return `{scanning: true, partial: [...]}` immediately, or block for ~3s until scan finishes? (First-scan latency concern Grok raised.)

---

## Sources
- Design doc under review: `design-pseudo-db-initial-population` v2
- Previous Grok review: `grok-review-pseudo-db-design`
- Grok call: `grok-4.20-reasoning`, ~$0.17
