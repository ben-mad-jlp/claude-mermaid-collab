# Grok review: pseudo-db design doc

Adversarial critique of `design-pseudo-db-initial-population` from `grok-4.20-reasoning`. Asked for flaws, missing features, alternative architectures, and risk ranking — explicitly told not to validate.

**Cost:** ~$0.20, 1689 prompt + 1270 completion + 1537 reasoning tokens.

**Headline:** Grok is harsh and mostly correct. The design is trying to be comprehensive instead of robust, and the concurrency model in particular is papering over hard problems with a filesystem lock.

---

## Flaws Grok flagged

### 1. Concurrency model is undercooked
> "The lock format (`{pid, runId, startedAt}`) is insufficient: PID reuse is real, lock files survive crashes, and there's no documented stale-lock recovery or fencing token mechanism. Two processes can easily both conclude the lock is stale and race."

Grok's point: we're introducing *more* concurrent mutation paths (chokidar watcher, SessionStart hook, manual `pseudo_rescan`, multiple Claude Code instances, git branch switches) and relying on a primitive fs lock to arbitrate between them. PID reuse after crash is real on Linux. No heartbeat, no fencing token.

### 2. Auto-trigger fire-and-forget is negligent
> "If the scan fails (OOM on large monorepo, ctags missing, permission error on `.collab/`, SQLite corruption, chokidar exploding), the failure is invisible until UI polls `pseudo_db_status`. There's no retry policy, exponential backoff, or 'this repo is broken, user must run `pseudo_rescan`' escape hatch."

Also: the design doesn't specify what happens on **upgrade of an existing populated DB** — `needsInitialScan` is set at migration time, so a schema-bump migration would re-trigger a full scan on an already-populated database. Unintended consequence.

### 3. Hash-gated incremental is broken across git branch switches
> "`source_mtime_epoch` is meaningless after `git checkout`; many files will appear deleted/added. The 'delete rows for files that vanished' logic will nuke the other branch's data. No branch key in the schema."

**This is a serious bug I missed.** If the user switches branches and a file doesn't exist on the new branch, the scanner would delete its `files`/`methods` rows — losing any manual prose tied to it. On switching back, they'd have to re-enter everything.

### 4. Docstring attribution landmines
> "JSDoc on arrow functions assigned to variables, Python dataclasses vs module vs function docs, C# XML on properties vs methods, JSDoc `/** @deprecated */` blocks, files with multiple competing styles. 'First line → title, rest → purpose' will produce garbage. `prose_origin='heuristic'` refusing to overwrite `llm` is fine, but the design never says how Claude is told the quality level. It will happily consume low-quality heuristic prose."

The unmissable point: **Claude reading the DB has no signal that prose is heuristic vs manual.** The "AUTO" badge is UI-only. The MCP tool results don't carry origin info, so the model uses low-confidence heuristic prose with the same weight as user-curated prose.

### 5. Priority scoring will break on real codebases
> "Git blame on vendored code, submodules, generated files (`*.pb.go`, `*-generated.ts`), and monorepos is going to be a disaster. The design adds `owner`, `touch_count_90d`, `priority` without specifying the formula. Git blame is slow and ambiguous. Submodules and monorepos destroy the assumption that 'one repo = one team.'"

The design waves "priority = touch_count × log(line_count)" but doesn't deal with the tail of edge cases.

### 6. `.pseudoignore` + `.gitignore` precedence undefined
> "`git ls-files` respects `.gitignore` but not necessarily nested or negated patterns the way users expect."

### 7. ctags is a support nightmare
> "Windows, version skew, output format differences, merging rules with regex scanner. The 'merge' logic is glossed over but will be full of edge cases around `isExported`, `isAsync`, call edges."

### 8. 12 days is fantasy
> "The biggest underestimate is the *interaction surface* between watcher, lock, incremental scanner, branch detection, error table capping, status polling, and the 9 new tools. Testing this reliably across macOS/Linux/Windows, git worktrees, monorepos, and flaky FS locks will eat most of the time."

---

## Missing features Grok identified

- **Scan cancellation** — no "stop eating my CPU" mechanism once a scan is running
- **Size throttling** — no "skip files > 500KB" or "only index top 300 files by priority"
- **Branch awareness** in schema or scan logic
- **Manual "high value" directory marking** — e.g. `core/` should get prose even if heuristics are weak
- **Detection of bad heuristic prose** → trigger LLM later (when user opts in)
- **DB size / token budget projection** before scanning
- **Migration story for heuristic data when parser improves** — old bad prose persists forever

---

## Alternative approaches worth considering

### Alt A — Don't auto-trigger at all
> "Make the React UI show a prominent 'Index project (first time)' button. Users understand explicit actions. Fire-and-forget background work across multiple Claude instances is a reliability nightmare."

This is a legit architectural fork. User-initiated indexing is more predictable, more debuggable, and sidesteps the concurrency model entirely. The cost is worse first-use UX — the first thing the user sees is an action prompt instead of a working DB.

### Alt B — Use SQLite itself for locking
> "A `scan_state` table with `status`, `pid`, `heartbeat_epoch`, `run_id`. FS locks are 1990s technology. You already have WAL."

Heartbeat in a row, not a file. Dead processes time out on stale heartbeats. Uses SQLite's own transaction semantics for the arbitration. **This is clearly better than the fs lock.**

### Alt C — Separate `file_metadata` table
> "Keep the `files` table lean. Put ownership, priority, touch stats, prose metadata in a distinct `file_metadata` table. The current ALTER TABLE bloat is ugly."

Matter of taste but Grok's right — we're planning to add 7 columns to `files`. A sidecar table is cleaner and makes the migration reversible.

### Alt D — Prose as colocated markdown files
> "Store prose summaries as colocated `.collab/pseudo/<file_hash>.md` files instead of (or in addition to) SQLite. Makes debugging trivial, allows gitignore-like semantics naturally, and survives DB wipes."

**This is genuinely interesting.** A `.collab/pseudo/src/services/pseudo-db.ts.md` on disk is:
- Trivially readable by humans and LLMs
- Survives db corruption
- Can be committed or ignored via normal git tools
- Can be edited by hand
- Can be diffed across branches by regular git tools
- **Eliminates the git-branch-switch incremental bug entirely** — each branch has its own tree of pseudo files, git handles everything

Trade-off: queries across all files now need a filesystem walk or a separate FTS index over the .md files. But Claude's primary read pattern is "give me the prose for one file," which is O(1) with colocated files.

### Alt E — Defer all priority/ownership work
> "Defer *all* priority/ownership work to a later 're-ranking' pass that runs on the already-populated DB rather than coupling it to initial scan."

Decouples initial population from ranking. Initial scan stays simple; ranking is a second pass that can be rerun/experimented with.

---

## Risk ranking (Grok's order)

1. **Concurrency model** (scan lock + chokidar + multiple MCP servers + SessionStart hooks + incremental). "Will produce the most subtle, hardest-to-reproduce bugs months later (stale indexes, half-populated DBs, duplicate work, corrupted priority counts)."
2. **Heuristic quality/attribution** creating confidently wrong data that poisons Claude's understanding.
3. **Git integration assumptions** (blame cost, branch switches, submodules, vendored code).

---

## Grok's aggressive cut for a 1-week solo ship

> "For a 1-week solo ship I'd cut: git-blame/ownership/priority/hot-files entirely, chokidar watcher (do incremental only on explicit rescan or SessionStart), ctags (regex + improved language coverage only), `scan_errors` table (keep simple counter + one recent error blob), half the new tools (`pseudo_team_ownership`, `pseudo_stats_delta`, `pseudo_list_heuristic_files`). Ship *just* auto-trigger + solid incremental + heuristic docstrings + status + rescan. Everything else is nice-to-have that turns V1 into a tar pit."

This is the minimum-viable core:
1. Shared walker
2. Auto-trigger (or user-initiated button — Grok's Alt A)
3. Hash-gated incremental with branch awareness
4. Docstring-first heuristic Level 2
5. `pseudo_db_status` + `pseudo_rescan`
6. Breaking change to `pseudo_upsert_prose`

**Everything else is deferred** — including ctags, git-blame, chokidar, team clusters, import graph, stats delta, heuristic list, and the watcher.

---

## What I (Claude) agree with and what I'd push back on

### Must-fix before implementation
- **Branch awareness in the schema.** This is a correctness bug waiting to bite. Either (a) use Alt D (colocated markdown files that git tracks naturally), or (b) add a `git_head_sha` or `branch` key to `files` rows. Cannot ship without one of these.
- **Origin visible to the model.** MCP tool results that return prose should carry `prose_origin` so Claude knows whether it's heuristic or manual. Otherwise the model trusts low-quality heuristic data.
- **SQLite lock table instead of fs lock.** Grok's Alt B. Strictly better than the fs lock and no extra complexity.
- **`needsInitialScan` on schema upgrade.** Clarify: only set on v0→v3 fresh migration, NOT on v2→v3 upgrade of existing populated DBs.
- **Scan cancellation API.** Needed for the watcher case and for user-initiated "stop" from the UI. `AbortSignal` already in the design; just needs to actually be plumbed everywhere.

### Where I'd push back on Grok
- **"Don't auto-trigger at all"** is too conservative. Auto-trigger is the right default — it's just that the concurrency and error handling underneath it need to be solid. Fix those rather than abandoning the feature.
- **"Cut ctags entirely"** loses Go/Rust/Java users permanently. Grok's alternative ("regex + improved language coverage") is actually *more* work than wrapping ctags. Keep ctags but make it strictly opt-in at first: if detected, use it; otherwise show a "install universal-ctags for Go/Rust support" notice.
- **"Cut git-blame/ownership entirely"** is fine for a V1 that ships on a deadline but loses one of the biggest downstream payoffs (ranked `listFiles()`, `/pseudocode-seed`). I'd keep it but move it to a separate post-scan re-ranking pass per Grok's Alt E — that way initial scan stays fast and simple, ranking gets its own testable module.

### Where Grok is flatly right
- **12 days is optimistic.** The interaction surface between watcher + lock + incremental + branch + status + tools is where test-time lives. More honest: **18–22 days** with the full scope, or **8–10 days** with Grok's aggressive cut.
- **Prose-as-files (Alt D)** is a better architecture than SQLite columns for prose content specifically. Worth seriously reconsidering the storage model.
- **`scan_state` heartbeat table (Alt B)** is clearly better than the fs lock. No reason not to adopt it.
- **Separate `file_metadata` table (Alt C)** is cleaner than ALTER TABLE bloat. Adopt.

---

## Revised recommendation

The design doc needs a second pass before it becomes an implementation plan. Specifically:

1. **Replace fs lock with SQLite heartbeat table** (Alt B)
2. **Add branch awareness** — either Alt D colocated files, or a `git_head_sha` column on `files`
3. **Surface `prose_origin` in MCP tool results** so Claude's reads are confidence-weighted
4. **Decouple priority/ownership into a separate post-scan re-ranking pass** (Alt E) — keeps initial scan simple and testable
5. **Split the file-metadata growth into a sidecar table** (Alt C)
6. **Fix the schema-upgrade-on-existing-DB footgun** for `needsInitialScan`
7. **Plumb `AbortSignal` through the entire scan path** — real cancellation, not just in the type signature
8. **Add size throttling** — skip files > 500KB by default, configurable
9. **Realistic scope estimate:** 18–22 days for full scope; 8–10 days for Grok's minimum-viable cut

**The single biggest open decision:** whether to adopt Alt D (prose as colocated markdown files) as the storage model. It elegantly sidesteps the branch-switching bug, survives DB wipes, and is human-debuggable — but it's a bigger architectural change than any of the other fixes on this list. Worth a full day of thinking before committing.

---

## Sources
- Design doc under review: session `bugfixes`, document `design-pseudo-db-initial-population`
- Grok call: `grok-4.20-reasoning`, ~$0.20
