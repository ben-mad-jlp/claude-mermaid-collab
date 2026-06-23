# Bug Verification — Results

Both bugs confirmed, and one is significantly worse than the round 3 framing suggested.

## Bug 1 — Call-graph queries return empty on mermaid-collab

### Empirical evidence

All three call-graph MCP tools return empty on this codebase right now:

```
pseudo_impact_analysis(fn=getImpactAnalysis, file=pseudo-db)
  → { "direct": [], "transitive": [] }

pseudo_call_chain(from=runFullScan/pseudo-indexer → to=insertCall/pseudo-indexer)
  → { "path": null, "exists": false }

pseudo_find_function(query="resolve callee")
  → []
```

`getImpactAnalysis` is a 43-line method at `pseudo-db.ts:876` that every other piece of the db calls into. If the call graph were populated, impact-analyzing it would return dozens of entries. It returns zero.

### Root cause — two parallel implementations, both broken

There are **two pseudo-db implementations coexisting** in the codebase, and the MCP tools route to the one that's empty.

**V2 (legacy):** `PseudoDbService` in `pseudo-db.ts`.
- Has `resolveCalleesForFile` at line 614 that correctly runs a two-pass `UPDATE method_calls SET callee_method_id = ...` — this is the resolution pass the agent was looking for.
- But V2 has no indexer populating it. It relies on external `upsertStructural` calls (setup.ts:4059), which nothing is systematically triggering for mermaid-collab.
- **V2 is empty** on this project — `pseudo_find_function` returning `[]` confirms the methods table has nothing.
- MCP tools `pseudo_impact_analysis`, `pseudo_call_chain`, `pseudo_find_function` all route through `getPseudoDb` → V2 → empty.

**V6 (new, in-memory):** `initPseudoDbV6()` + `pseudo-indexer.ts` + `pseudo-overlay.ts`.
- `insertCall` at `pseudo-indexer.ts:127` hardcodes `callee_method_id = NULL`:
  ```sql
  INSERT INTO method_calls(caller_method_id, callee_name, callee_method_id, file_path) VALUES (?, ?, NULL, ?)
  ```
- `runFullScan` (pseudo-indexer.ts:486) deletes and re-inserts all `method_calls`, re-calling `insertCall` — so it writes NULL then never resolves.
- There's **no `resolveCalleesForFile` equivalent anywhere in the v6 code path.** I grepped for `SET callee_method_id` / `resolveCall` across all v6 files. Zero matches outside the v2 file.
- The v6 schema has a `callee_method_id` column (pseudo-schema.ts:65) and an index on it (`idx_method_calls_callee_id`) — the column is expected to be populated; the code just doesn't do it.
- V6 is what powers `pseudo_db_status` (shows 426 files, 2109 methods) — so v6 *is* being indexed. The call_chain_v6 MCP tool (setup.ts:4200) uses the v6 `pseudo_call_chain` from `mcp/tools/pseudo-graph.ts:40`, which queries `WHERE callee_method_id IS NOT NULL` — matching zero rows because every row is NULL.

### The net effect

- **V2** has working resolution logic but zero data.
- **V6** has data (2109 methods) but broken resolution — `callee_method_id` is NULL for every row.
- **Every call-graph MCP tool returns empty**, regardless of which path it uses.

**The counterfactual-probe primitive that the round 3 proposal was going to build on doesn't work on this codebase today.** Impact analysis, call chain, find function — all dark. pseudo.db's call-graph promise is entirely unfulfilled for mermaid-collab.

This needs fixing before anything else in the round 3 plan is actionable.

### Minimal fix

One of two paths:

1. **Port `resolveCalleesForFile` to v6.** Add a post-scan pass in `pseudo-indexer.ts` after `runFullScan`'s insert loop that walks `method_calls` and resolves `callee_method_id` by joining `callee_name` against `methods.name`. The v2 version used `file_stem` as disambiguation — v6 would need similar (either record the callee file hint at insert time or fall back to "pick the closest match by caller's file_path"). Moderate effort — maybe 50 lines plus a test.

2. **Abandon v6 call edges and unify on v2.** If v6 was never supposed to own the call graph, route the MCP tools consistently through v2 and add a structural-upsert trigger to the v6 scan so v2 gets populated whenever v6 does. Cleaner long-term but requires coordinating two storage layers.

Either way, until this is fixed, no "spec drift"-related tool that depends on call edges will work.

## Bug 2 — Zero prose exists for this codebase

### Empirical evidence

The `.collab/pseudo/prose/` directory contains **exactly one file**:

```
/srv/codebase/claude-mermaid-collab/.collab/pseudo/prose/Users/benmaderazo/Code/claude-mermaid-collab/src/services/source-scanner.ts.json
```

That path is a **macOS absolute path** (`Users/benmaderazo/Code/...`). It's a leftover from someone else's machine, copied via git-ignore carve-out or rsync, and it has no mapping to this Linux project's paths (`/srv/codebase/claude-mermaid-collab/...`).

The overlay matcher (`pseudo-overlay.ts`) cannot associate this prose with any scanned source file because the file_path key doesn't match. It becomes an orphan — exactly matching `warnings.orphanCount: 1` from `pseudo_db_status`.

### What the 198 "filesWithProse" number actually means

It's not method-level prose. Looking at `pseudo-indexer.ts:140`:

```typescript
updateFileHeuristic: db.prepare(
  `UPDATE files SET title = ?, purpose = ?, file_prose_origin = 'heuristic' WHERE file_path = ?`,
),
```

When the indexer scans a file and extracts a docstring-level title/purpose from the file header (via `pseudo-docstring.ts`), it bumps `file_prose_origin` to `'heuristic'`. That counter is what `filesWithProse: 198` counts — **files with a file-level heuristic title extracted from docstrings.** Not methods with prose. Not reviewed content. Not anything a human or LLM wrote.

Meanwhile `proseBreakdown.heuristic: 0` counts *methods*, of which there are zero. Every single method in the 2109 has `prose_origin = 'none'`.

### Net finding

**There is literally zero intent content in pseudo.db for mermaid-collab.** Not a drop. The system is an empty storehouse with a working structural index on top. Whatever round 3 assumed was "substrate already present" is wrong — the infrastructure exists but the data doesn't.

This changes the recommendation weight: the unused-by-adoption framing in round 3 was understated. It's not just that nobody runs `/pseudocode` occasionally — nobody has ever put prose into this codebase's pseudo.db at all.

## Revised Assessment

The round 3 verdict said "pseudo.db is 70–80% of the answer, but nobody's using it." Both bugs push that number down:

- **The call-graph half is broken.** Counterfactual probing doesn't work. That's the primitive both agent and Grok said was the strongest argument for pseudo.db being "already built."
- **The prose half is empty.** The Current Reality Mirror has zero content. It's not a mirror today — it's a mirror frame with no glass.

What's genuinely present and working:
- Structural index (files, methods, signatures, body fingerprints) — yes, 2109 methods
- Hot-files ranking — yes
- v6 overlay matcher with rename detection — present but has nothing to overlay
- Drift detector (bytes-level) — yes
- `/pseudocode` skill — exists but never run
- UI — exists but nothing to render

The substrate is ~40% real and 60% potential. The 30% that round 3 said was missing (the reflex / adoption) is real, but there's another 30% missing that round 3 assumed was already in the bank: **the data itself, and the call-graph resolution that makes impact analysis work.**

## Concrete Next Steps (revised)

The order matters now:

1. **Fix the v6 call-edge resolution** (or route consistently to v2 and populate it). Without this, no impact-analysis-based mechanism is possible. 1–2 days of work including tests.
2. **Delete the orphaned macOS prose file** (or migrate its path mapping). Tiny cleanup. The orphan count should go to zero.
3. **Actually run `/pseudocode` on a bounded slice** — the three most-recently-touched files, say. This is the round 2 seed-probe plan, but it has to happen *after* step 1 or the call-graph context the skill would benefit from isn't there.
4. **Only then** does the round 3 reflex proposal become viable: make drift events spawn reconciliation sessions using data that actually exists.

The cheap-next-step claim from round 3 ("one afternoon building the drift-triggered reconciliation prototype") was optimistic. It assumed working call graph + existing prose. Neither is true. The realistic path is: fix the bugs first, seed the data second, build the reflex third.

The two bugs also explain something that was puzzling earlier: if pseudo.db were the elegant 80% solution Grok described, *why isn't anyone using it?* The honest answer is probably: **because for this codebase, it doesn't actually work.** The adoption gap isn't laziness — it's that the tool doesn't deliver value on a codebase where the call graph is empty and no prose has been written. People tried, got empty results, and moved on. That's a much more sympathetic diagnosis than "passive systems die" and it suggests the fix is concrete (repair the bugs) rather than cultural (change human behavior).