# Pseudo-db initial population — Claude + Grok research

Two independent research passes on: **how should the pseudo-db be populated on first use?**

---

## Current state (grounded facts, not speculation)

- **`pseudo_index_project`** (`src/mcp/setup.ts:3753-3799`) is regex-based, structural-only, zero LLM calls. Produces method names / line ranges / params / visibility.
- **Level 1 (structural)** fills `files` + `methods` tables via `upsertStructural` (`src/services/pseudo-db.ts:342-440`). Pure regex per language in `source-scanner.ts`.
- **Level 2 (prose)** — `method_steps` + `title`/`purpose`/`module_context` — filled by `upsertProse` (`pseudo-db.ts:446-563`), called **only** from a manual per-file `/pseudocode <file>` workflow in an active Claude Code session. Tokens come from the user's session. No bulk API.
- **Two uncoordinated walkers** exist (`setup.ts:3757-3783` and `pseudo-db.ts:256-277`) with different extension rules.
- **`needsInitialScan` is dead code** — set at migration time (`pseudo-db.ts:286,316,334`) but never read. Nothing auto-triggers population.
- **No incremental mode** — every call re-scans and re-upserts every file. No hash/mtime/git-diff gate.
- **Regex scanner covers:** TS/JS/TSX/JSX/MJS, PY, CS, CPP/CC/CXX/C/H/HPP (`source-scanner.ts:27-41`). **Silent miss:** Go, Rust, Java, Kotlin, Swift, Ruby. C/C++ marked "good-effort" by its own header comment.
- **Level 2 has no bulk entry point.** One file per MCP round-trip.
- **Error reporting** is a single counter — no per-file detail.

## Hard constraints

- **MCP sampling is NOT supported by Claude Code** ([#1785](https://github.com/anthropics/claude-code/issues/1785)). Server cannot borrow user's Claude subscription for cheap Haiku cycles.
- **No server-side background Tasks** an MCP server can schedule.
- **No server-side Anthropic API key by default.** Must be opt-in.
- **Prose is paid for by the user's active Claude Code session** — status quo, not ideal.

---

## Claude's research (recommendation: ship A+B+C as v1, defer D to v2)

### Approach A — Auto-index on first open
Kick off the walk inline (or in a Bun worker) when `getPseudoDb` sees `needsInitialScan`. Extract the walker from `setup.ts` into `source-scanner.ts` so `pseudo_index_project` and `getCoverage` share one. **Seconds to minutes, zero tokens, low complexity.** Kills pain points #1, #2, #3. Doesn't add prose.

### Approach B — Incremental hash-gated re-index
Add `source_mtime` alongside existing `source_hash`. Stat-first pass, only re-scan changed files. Drop rows for files that disappeared. **Near-instant warm runs.** Kills pain #5. Mtime can lie across branch switches.

### Approach C — Tree-sitter instead of regex
Swap per-language regex scanners for `web-tree-sitter` + WASM grammars (TS, Python, Go, Rust, Java, C#, C++). Keep `StructuralMethod[]` contract stable so downstream tools don't change. ~5 MB per grammar, 2–5× slower than regex but still sub-second per file. **~1–2 days rewrite.** Fixes pain #7 (Go/Rust/Java free). Gives real AST → cheap imports/exports extraction → real call graph instead of fragile stem-based `resolveCalleesForFile`. No prose.

### Approach D — Import-graph-driven prose seeding (V2)
After A/B/C land, compute static importance per file: import fan-in × `log(line_count)` × git-log recency. Store `priority` on `files`. New tool `pseudo_get_high_priority_files(project, limit)` + new `/pseudocode-seed` skill that walks top-K in the user's session. **Bounded Claude-session token spend** on highest-signal files. Long tail stays structural-only.

### Approach E — Git-history-driven lazy seeding
Instead of upfront walk, seed only git-hot files (commit count over 90d + current-branch diffs). Lazy-scan on cache miss via `pseudo_get_file_state` interception. **Instant first-session**, tiny per-request cost on cold files. First read of any file pays latency. Non-git projects need fallback.

### Approach F — Embeddings-only sidecar
New `file_embeddings` table. Local `all-MiniLM-L6` (~25MB) via `@xenova/transformers` or `sqlite-vec`. New `pseudo_semantic_search` tool. **Fully offline, zero tokens.** Different product — doesn't produce human-readable prose, but gives Claude "which files are relevant?" semantic retrieval that may be more useful than prose summaries anyway. Parallel track, don't block v1.

### Claude's V1 scope (actionable)
1. Extract shared walker into `src/services/source-scanner.ts`
2. Wire `needsInitialScan` into `getPseudoDb` → auto-populate in background + expose new `pseudo_db_status` tool
3. Make scan incremental (`source_hash` + `source_mtime`, drop dead rows)
4. Replace regex scanners with tree-sitter (same `StructuralMethod[]` contract)
5. Return per-file failure reasons

**What changes in code:**
- `src/services/source-scanner.ts` — tree-sitter rewrite + `walkProject()` helper
- `src/services/pseudo-db.ts:300-335` — `getPseudoDb` walker callback, auto-populate on `needsInitialScan`
- `src/mcp/setup.ts:3753-3799` — `pseudo_index_project` becomes thin wrapper, adds error array
- `package.json` — `web-tree-sitter` + grammar WASMs

### Claude's open questions
1. Sync vs background first scan? 2000-file repo = 20–60s tree-sitter pass.
2. `web-tree-sitter` (WASM, portable, ~5MB/grammar) vs native tree-sitter for Bun (faster, rougher support)?
3. Is "prose via user's session" acceptable as permanent, or grow optional server-side API key path?
4. Is Go/Rust/Java priority real, or TS-only fine (stay on regex, cut v1 scope)?
5. Store import graph as first-class table (enables D + real `pseudo_impact_analysis`) or keep transient?

---

## Grok's research (grok-4.20-reasoning, ~$0.25)

Asked Grok to push *beyond* Claude's recommendations and think unconventionally. It delivered genuinely different angles.

### Approach 1 — Universal CTags bootstrap
Replace regex walkers with **universal-ctags** for day-1 structural coverage of 50+ languages. `ctags --output-format=json --fields=+nS --extras=+q -R` → parse JSON → map kinds (function/method/class/macro) to the two-tier schema. For Level 2: extract comment block immediately preceding each tag + 15-line symbolic heuristic (first sentence → title, noun phrases → purpose, bullets → method_steps). Directory README proximity → module_context.

- **Cost:** 2 dev-days + ~4 MB bundled binaries. <3s even on large repos. Zero tokens.
- **Pros:** Immediate Go/Rust/Java/Kotlin coverage, accurate inheritance/scopes, **some prose on day 1 instead of zero**.
- **Cons:** ctags occasionally misfires on heavy macros/decorators; heuristic prose is shallow.

### Approach 2 — Git-blame ownership maps
Turn git history into symbolic importance + ownership layers. `git ls-files` + `git log --name-only` → priority queue. Structural scan runs on everything; Level 2 heuristic prose + **ownership field** ("last touched by X in Y commits") on top 40% by recency × frequency. Per-function blame → `methods.owner`. Dominant author + path conventions → `files.module_context`.

- **Cost:** 1.5 dev-days, <1s extra on first scan.
- **Pros:** Dense useful context on the 20% of files that matter. Claude immediately understands **ownership** and hot modules without manual work.
- **Cons:** Useless on non-git codebases; blame noisy in monorepo or vendored code.

### Approach 3 — Docstring-first symbolic pass
Treat existing comments as **free Level 2 data**. Walk every function looking for JSDoc, rustdoc, godoc, triple-slash. Full docstring → raw field; first non-empty line → title; imperative verbs + nouns → purpose; `@param`/`@return` blocks → steps. Files without docs: module_context synthesized from nearest README headings + directory noun clustering. **All deterministic, zero LLM.**

- **Cost:** 1 dev-day. Negligible runtime.
- **Pros:** **Guarantees Level 2 data everywhere on first scan.** Users only spend Claude tokens on *upgrading* prose they dislike. Dramatic for documented codebases.
- **Cons:** GIGO on projects with bad comments; can't invent insights that aren't present.

### Approach 4 — Shipped pattern library + fingerprint matching
Bundle 200 pre-populated pseudo entries for common frameworks. Compute cheap fingerprint (top-level dirs, package.json/gomod/cargo.toml keys, imports for known libs). On match, hydrate method titles/purposes from library (e.g. "React useEffect wrapper", "Express controller", "Axum handler"). Custom code falls back to structural + docstring heuristics. Library lives in plugin as versioned JSON.

- **Cost:** High initial (2 weeks to seed library) + ongoing curation. Runtime negligible.
- **Pros:** React/Next.js/FastAPI/Django/etc. get **high-quality prose instantly** with zero user tokens. Effectively crowd-sourced once.
- **Cons:** Only helps popular stacks; library maintenance burden; stale patterns.

### Approach 5 — Opt-in local LLM one-shot (Ollama/LM Studio)
Use user's existing local model for bulk initial prose **exactly once, with explicit consent**. Detect Ollama or OpenAI-compatible localhost endpoint. Surface React dialog: "Populate prose for 247 files using your local qwen2.5-coder? ~8 min on CPU." Batch 8–12 files per request, tight prompt emitting only Level 2 fields. Results land in SQLite exactly as manual `/pseudocode` does today.

- **Cost:** User CPU/GPU time (one-time). ~2 dev-days + prompt tuning.
- **Pros:** **Real LLM prose on day 1 without touching Claude subscription or needing server API key.** Fully opt-in. Scales to entire codebase.
- **Cons:** Quality varies by model; some users have no local setup; consumes local resources.

---

## Side-by-side: where they agree and diverge

| Theme | Claude | Grok |
|---|---|---|
| **Structural layer replacement** | Tree-sitter WASM grammars | Universal-ctags binary |
| **Prose without LLM** | Doesn't try — leaves prose to manual/user-session | Docstring-first heuristic (#3) + shipped pattern library (#4) |
| **Prioritization** | Import-graph fan-in (D) | Git-blame recency × frequency (#2) |
| **LLM prose seeding** | Import-graph-scoped `/pseudocode-seed` (user's session tokens) | Opt-in local Ollama one-shot (#5) |
| **Incremental** | Hash-gated + mtime (B) | Not addressed |
| **Semantic retrieval** | Local embeddings sidecar (F) | Not proposed |
| **Error detail** | Per-file failure reasons in result | Not addressed |

### Overlap that reinforces
Both independently landed on: (a) the structural layer must stop being the user's concern, (b) prioritization is essential because treating every file equally wastes work, (c) the no-MCP-sampling wall means LLM prose has to come from *somewhere else*.

### Where Grok adds genuinely new angles
1. **Universal-ctags as the structural engine.** Faster to integrate than tree-sitter, more languages out of the box, and avoids bundling WASM grammars. The tradeoff: ctags doesn't give you a real AST, so downstream features that would benefit from one (real call graph, import-to-symbol resolution) stay regex-esque. **Worth considering as a faster path to multi-language coverage.**
2. **Docstring-first deterministic Level 2.** This is the biggest insight Claude missed. Many real codebases already have JSDoc / rustdoc / godoc — it's free Level 2 data sitting on disk that *nobody is parsing*. Deterministic, zero tokens, incremental friendly. **Almost certainly worth building regardless of which structural path you pick.**
3. **Git-blame ownership maps.** `owner` / `hot module` metadata is arguably more valuable to Claude than prose for answering "who should I ask about X?" or "what's risky to change?" questions. Small dev cost, real UX payoff.
4. **Shipped pattern library.** The most speculative idea — high curation burden — but the insight is sound: for common frameworks, you can crowd-source the summaries once and ship them. Effectively works like a free tier of prose for any React/Next/FastAPI/Axum codebase.
5. **Opt-in local Ollama path.** Cleanly sidesteps the "no server-side Anthropic key + no MCP sampling" wall by using what's already on the user's machine. Opt-in consent dialog + one-shot bulk pass is a clean UX.

### Where Claude's angles still matter
- **Incremental hash-gated scanning** — Grok didn't address this at all. Still the most important ergonomic fix.
- **`needsInitialScan` wiring** — the actual auto-trigger piece neither of Grok's approaches explicitly address.
- **Tree-sitter gives a real AST** which unlocks real call-graph and real import resolution downstream — long-term, richer than ctags.
- **Local embeddings sidecar (F)** is a fundamentally different retrieval strategy that neither of the prose-oriented approaches touch.

---

## Synthesized recommendation (opinionated)

If I were building this, the strongest path combines both:

**V1 (a week of work, zero tokens, real user value):**
1. **Shared walker** + **`needsInitialScan` auto-trigger** + **hash-gated incremental** (Claude A+B)
2. **Docstring-first deterministic Level 2 pass** (Grok #3) — guarantees *some* prose on day 1 from docs that already exist
3. **Per-file error reporting** (Claude)

**V1.5 (adds multi-language + ownership, ~3 more days):**
4. **Universal-ctags as structural engine** (Grok #1) — faster than tree-sitter to land, gets Go/Rust/Java/Kotlin/Ruby for free
5. **Git-blame ownership + hot-file scoring** (Grok #2) — priority queue for downstream tools

**V2 (opt-in richer prose, parallel tracks):**
6. **Opt-in Ollama bulk prose** (Grok #5) — one-shot dialog, local cycles, no server key
7. **Import-graph `/pseudocode-seed` skill** (Claude D) — for users without local LLM, bounded session-token spend

**V2.5 (retrieval layer):**
8. **Local embeddings sidecar with sqlite-vec** (Claude F) — parallel product, semantic search alongside FTS

**Tree-sitter** (Claude C) stays on the roadmap only if ctags turns out too shallow for real call-graph / impact-analysis work downstream. Ship ctags first; upgrade later if the evidence demands it.

**The headline insight from both passes:** the current regex + manual-prose split is worse than either pure-structural or pure-heuristic-prose would be, because it commits to the ceremony of manual prose without getting any of the benefit until you've done the manual work. The fix is to ensure **every file has at least shallow heuristic prose on day one** — from docstrings, from ctags comments, or from a library — and let users/skills *upgrade* from there.

---

## Sources
- Claude research by general-purpose subagent (internal)
- Grok consult-grok call: `grok-4.20-reasoning`, 604 prompt + 1139 completion + 2728 reasoning tokens (~$0.25)
- [MCP Sampling Feature Request #1785](https://github.com/anthropics/claude-code/issues/1785)
- [Universal Ctags](https://github.com/universal-ctags/ctags)
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
