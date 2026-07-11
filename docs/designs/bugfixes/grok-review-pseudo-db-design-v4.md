# Grok v4 review

Fourth adversarial pass. Grok refused to green-light but narrowed the criticism to two genuinely-blocking issues + a few scope/rebuild concerns. The commit-only-prose architectural split is acknowledged as "genuinely better" — it's the execution details underneath that Grok flagged.

**Cost:** ~$0.16.

**Verdict:** *"Close, but not there. The identity problem and the watcher reliance are blocking. Fix the method identity to something stable... and add a periodic lightweight validation pass. Then it might be shippable. Currently it is v3.5 with better marketing."*

---

## Grok's hits

### 🔴 BLOCKING — must fix before implementation

#### 1. Method identity `(name, params)` is still broken
> Rename refactors make prose invisible with no useful warning (you only detect param changes, not name changes).
> Overloads break it completely.
> Same-name methods in different classes/files create ambiguous attachment with no clear resolution rule.
> The `param_mismatch` flag helps but surfaces too late and too vaguely.

> This is the single largest remaining UX landmine. Prose that silently detaches during normal refactoring destroys trust.

**Grok is right.** `(name, params)` fails on:
- **Rename refactor:** `foo` → `foobar`, prose file still references `foo`, overlay finds nothing, manual prose silently becomes invisible.
- **Overloads:** `foo(x: number)` and `foo(x: string, y: number)` are different methods with different prose, but identity collisions can occur depending on how we canonicalize params.
- **Same name across files/classes:** two classes both have `save()`; which prose attaches where?

#### 2. Watcher is NOT authoritative
> Chokidar is good but not authoritative. It loses events under:
> - Editors that unlink+replace (very common)
> - `git checkout`, `rsync`, IDE syncs, WSL interop
> - Laptop sleep / SIGSTOP / long GC pauses
> - Rapid refactor bursts that overflow its internal queue
>
> Your "rebuild on next server start" safety net only helps if the server actually restarts. Long-lived dev sessions (weeks in VS Code) will silently drift.

**Grok is right.** The design bets the farm on chokidar reliability. Real editors (VS Code's atomic save, vim's swap-file + rename, many others) don't fire `change` events — they fire `unlink` + `add`. Chokidar handles this most of the time but isn't 100%.

### 🟡 Real but less severe

#### 3. Rebuild time estimate is optimistic
> Honest median is **9-18s** on M3-class hardware, worse on CI or spinning rust or large monorepos. Your "background scan, readers wait on promise" story collapses when the first MCP call after restart blocks for 15s.

Grok's breakdown:
- `git ls-files` + walk: ~400ms
- Regex + docstring extraction across ~2.5M LOC: 4-7s
- SQLite inserts + FTS5 indexing + recursive call edges: 3-6s
- Committed prose overlay: negligible

**Verdict:** 3-10s was marketing. Honest is 9-18s.

#### 4. Git friction will grow over time
> Your optimistic "30 files" assumes disciplined use. In practice `/pseudocode` is addictive. Once engineers realize the output is useful, adoption spreads and you will see hundreds of prose sidecars within weeks.

#### 5. Orphaned prose detection is inadequate
> Distinguishing "deleted" vs "on another branch" requires git integration you don't have. Rename tracking across the prose tree is non-trivial and you have no story for it.

#### 6. 18-22 days is a lie
> **28-35 days**. You've been consistently low on every previous version.

### 🟢 Acknowledged as fine
- Bun `:memory:` SQLite with FTS5 — "mostly fine, minor risk, not blocking"
- Schema migrations → no migrations because fresh DB every time → "smart"

---

## Claude's take on Grok's v4 review

### On method identity (THE hit that matters)

Grok is dead right. `(name, params)` is a trust-destroying footgun. A single rename refactor makes manual prose invisible with no signal to the user. This is the kind of silent failure that erodes confidence in the whole tool.

**Proposed v5 fix — hierarchical identity with a stable synthetic ID:**

```json
{
  "methods": [
    {
      "id": "m_a4f3c8b1",           ← NEW: stable synthetic ID, generated on first write
      "name": "getPseudoDb",
      "enclosing_class": null,
      "params": "project: string",
      "prose_origin": "manual",
      "steps": [ ... ]
    }
  ]
}
```

On overlay, lookup in priority order:
1. **Primary:** `id` match against an in-memory `stable_id → method row` mapping. But wait — how does the in-memory SQLite know the ID? We need a way to go from `(class, name, params)` in source → `id` in prose. The mapping has to be rebuilt on every scan.
2. **Secondary:** `(enclosing_class, name, params)` exact match.
3. **Tertiary:** `(enclosing_class, name)` match with param mismatch warning.
4. **Quaternary:** `name` alone with class + param mismatch warning.
5. **Orphan:** no match → flagged, surfaced in `pseudo_db_status.warnings`.

**New MCP tool: `pseudo_reassign_prose(old_path, old_method, new_path, new_method)`** for explicit rename refactors. When the user renames `foo()` to `foobar()`, they run this to move the `id` binding.

**Smarter auto-detect for renames:** on scan, when a prose file's method can't be matched, do a fuzzy lookup in the same file's source methods using:
- Same param signature → 80% confidence match
- Same param count + body token Jaccard > 0.6 → 60% confidence match
- Surface top 3 candidates in `pseudo_db_status.warnings` as `"methodFoo may have been renamed to methodFooBar (confidence 85%) — run pseudo_reassign_prose to confirm"`

### On watcher reliability

Grok is right that the watcher has real failure modes. Fix: **add a periodic background drift check** without re-introducing v2's reconcile latency trap.

**Proposed v5 drift strategy:**
- **Continuous:** chokidar watches as before
- **Periodic:** every 5 minutes while the server is running, do a background `git ls-files` + stat pass. Compare against in-memory `files.source_mtime`. On mismatch, trigger `runIncrementalScanForFile`. Runs in a background task; does not block MCP calls.
- **Idle-triggered:** after 60s of no MCP activity, do a deeper content-hash validation on a random 10% sample of files. Catches in-place edits that preserve mtime.
- **On important operation:** `pseudo_rescan({mode: 'drift_check'})` is exposed as an explicit tool users can invoke before a big refactor session.

The 5-minute background check is the primary safety net for editor unlink+replace and chokidar misses. It runs off the main path so MCP latency stays microseconds.

### On rebuild time (9-18s)

Grok is probably right. The realistic answer is **add `.cache/derived.sqlite` snapshot to v1 after all.** My v4 design punted it; I should un-punt it.

Protocol:
- At the end of every successful `runFullScan`, serialize the in-memory SQLite to `.cache/derived.sqlite` (bun:sqlite has a `serialize()` method, or we use `ATTACH DATABASE 'file:.cache/derived.sqlite'` + copy)
- On server start, check cache validity:
  - File exists
  - Schema version matches current
  - `git ls-files` file list count matches cache's
  - Random 10-file source_hash sample verifies
- If valid → load cache into `:memory:` (~500ms)
- If invalid → rebuild from source (9-18s)

Adds ~1 day to scope. Converts "cold start always painful" into "cold start painful once per source change; warm start ~500ms."

### On git friction growing

Grok's point is fair — committed prose files will accumulate. But the user is in control: if they don't want the tree growing, they can run `/pseudocode` less, or use the heuristic-only path (which never writes to disk).

**Possible v5 mitigation:** `pseudo_upsert_prose(..., persist: 'always' | 'ephemeral')`. `'ephemeral'` writes only to in-memory SQLite; survives server lifetime but dies on restart. `'always'` (default) writes to committed file. Lets power users opt out of committing per-file.

### On orphaned prose

Grok's right that the manual tool is weak. Fix: **auto-detection with branch awareness.**

On scan:
- Prose file has no matching source file in current source walk
- Check `git ls-files --all-branches` (or iterate through `git branch -a` calling `git ls-tree`) to see if the file exists on any branch
- If yes → mark `status: 'cross-branch'`, leave untouched, don't surface as orphan
- If no → mark `status: 'orphan-candidate'`, surface in `pseudo_db_status.warnings` with suggested fuzzy-match candidates from same-directory source files

Adds complexity but is tractable.

### On scope: 28-35 days

Grok's estimate is probably right. 18-22 was a point-range pretending to uncertainty. **Honest revised range: 25-35 days** accounting for:
- The v5 additions above (identity fix + drift check + snapshot + orphan detection): +4-6 days
- Windows path edge cases: +1-2 days
- Testing across multi-language sample repos: +2-3 days
- Documentation + migration guide: +1-2 days

---

## Triage summary for next iteration

If we rev to v5:

**Must fix:**
1. **Method identity:** stable synthetic `id` with hierarchical fallback lookup + `pseudo_reassign_prose` tool + fuzzy rename detection
2. **Watcher reliability:** periodic background drift check every 5min + idle-triggered 10% sample hash validation
3. **Cold start:** un-punt `.cache/derived.sqlite` snapshot back into v1
4. **Orphan detection:** cross-branch-aware, with fuzzy rename candidate suggestions
5. **Scope estimate:** honest 25-35 days

**Accept and document as limitations:**
- Git friction grows with adoption — user controls this via how often they commit
- OneDrive / cloud-sync path flakiness
- Editors that unlink+replace are handled via the 5min drift check, not via chokidar heroics

**Alternative: ship v4 knowing the gaps**
- Accept that rename refactors will break attribution — surface warnings, user runs `pseudo_reassign_prose` manually
- Accept 9-18s cold start as "first call after restart may be slow"
- Accept long-lived sessions may drift — document `pseudo_rescan({mode: 'full'})` as manual remediation

**Or: cut scope dramatically**
- Drop ctags, drop git-blame ranking, drop chokidar watcher
- Ship only: auto-trigger + regex scanner + docstring heuristics + committed prose + pseudo_db_status
- Re-evaluate after users hit the gaps

---

## Sources
- Design doc under review: `design-pseudo-db-initial-population` v4
- Prior reviews: `grok-review-pseudo-db-design`, `grok-review-pseudo-db-design-v2`, `grok-review-pseudo-db-design-v3`
- Grok call: `grok-4.20-reasoning`, ~$0.16
