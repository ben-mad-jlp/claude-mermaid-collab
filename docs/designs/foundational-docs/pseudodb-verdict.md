# Does pseudo.db Solve This? — Verdict

Round 3. Both agent and Grok independently read the evidence and converged hard: **pseudo.db is ~70–80% of the Mirror/Ledger proposal we spent two rounds deriving. We were reinventing a wheel that's already built in this same codebase.**

Grok, unhedged:
> *"We spent two rounds deriving them from first principles and landed within 10% of what was already running in the same project. That should make us uncomfortable."*

## What pseudo.db Already Is

| Round 2 Proposal | pseudo.db Reality |
|---|---|
| **Current Reality Mirror** — non-judgmental "what this code believes," scoped to module, updatable | Prose per method: title, purpose, module context, per-method numbered English steps, CALLS references. Exactly this. |
| **Counterfactual probing** — "what would notice if this were removed?" | `pseudo_impact_analysis(fn)` returns direct + transitive callers from the call graph. Literally this. |
| **Touch-triggered excavation** | `/pseudocode` with no args processes files changed since last commit. Reads file state, detects source-hash changes, upserts. Structurally identical. |
| **Hot-files attention flow** | `pseudo_hot_files` ranks by churn/importance. Already there. |
| **Don't canonize drift — floor-mark at HEAD** | `prose_origin` distinguishes `heuristic` (DRAFT, auto-extracted from docstrings) from `manual`/`llm` (explicit). Heuristic prose is low-status by design. Our "floor-mark / observed-until-touched" proposal is *already* the origin system. |
| **Cold-start paradox** | Accidentally solved — heuristic origin is exactly the "substrate, not canon" status we proposed. |
| **Tagging schema** (load-bearing / observed / tolerated / regret) | Partial — origin tags give ~80% via `heuristic ≈ observed`, `manual ≈ load-bearing-ish`. Missing: `tolerated` and `regret`. |
| **Spec Delta / Pre-flight Diff** | Missing as a skill, but all the primitives exist — `impact_analysis` + `import_graph` + `search`. Maybe 150 lines of glue. |
| **Rename survival / drift-resistance** | v6 body-fingerprint matcher with 6-step hierarchical matching. `match_quality` tags: `exact`, `param_mismatch`, `class_mismatch`, `fuzzy_rename`, `fuzzy_move`, `orphan`. Prose survives code moves. We hadn't even thought of this. |
| **UI** | `/pseudo/` page, side-by-side viewer, function jump panel — already shipped. |

## The Damning Fact

**The infrastructure exists but nobody's using it.** On mermaid-collab *itself*: 426 files indexed, 2109 methods, and **all 2109 methods show `prose_origin: none`.** 198 files have prose stubs on disk but coverage reports 0%. There's a metric inconsistency that's itself a finding — either the overlay matcher is silently failing (canonical bug risk) or nobody's run `/pseudocode`.

Grok's read on this, which I think is the sharpest line in the entire session:

> *"Passive systems die. A database waiting for someone to run `/pseudocode` is indistinguishable from documentation theater. Prose writing feels like overhead until drift has already bitten. The value is retrospective. The right trigger is not 'run the skill.' The right trigger is the drift event itself."*

This is the 30% that isn't in pseudo.db today. The substrate is built; the **reflex** isn't.

## Two Critical Findings From Code-Reading

The agent actually read the source. Two concerning things surfaced:

### 1. v6 call-edge resolution may be broken
In `pseudo-indexer.ts:127`, the v6 `insertCall` path writes `callee_method_id = NULL`, and the agent saw no v6 resolution pass equivalent to v2's two-pass update. **If this is correct, `pseudo_impact_analysis` returns empty results on v6** — which means the counterfactual-probe half of the answer is broken today and nobody noticed. Needs verification.

### 2. Overlay matcher vs. prose-origin-none paradox
Prose lives as JSON files under `.collab/pseudo/prose/`. The in-memory v6 db is rebuilt from source + prose files; `pseudo-overlay.ts` runs a 6-step matcher that stamps `prose_origin`. If 198 prose files exist on disk but all methods show `none`, then either (a) nobody wrote prose beyond a file-level stub, or (b) the overlay isn't matching prose to current source methods (e.g., body fingerprints drifted) — which would mean pseudo.db's core claim of rename/refactor survival is silently failing on its own codebase.

**The agent called this the "question that matters most":** which of the two diagnoses is correct? They lead to completely different next steps. You can't design the ledger layer on top without knowing.

## The Consolidated Recommendation

Both sources said **fold, don't fork**. The marginal cost of extending pseudo.db is ~2–3 weeks. The cost of a parallel ledger is eternal context switching and eventual reconciliation hell.

Concrete plan, merging both responses:

### The 30% That's Missing

1. **Audit / fix the v6 call-edge NULL issue.** If `pseudo_impact_analysis` is broken on v6, nothing else works. This is the first thing to verify.
2. **Diagnose the `prose_origin: none` anomaly.** Figure out if it's a matcher bug or an adoption bug. Don't build on top until you know which.
3. **Add `intent_tags` to the prose schema.** Two new values: `tolerated` (works but we'd fix if cheap) and `regret` (known wrong, don't defend). ~20 lines of schema change. Provenance (`heuristic`/`manual`/`llm`) stays on its own axis — it answers "who wrote this." Intent tags answer "what is its status."
4. **Optional `@contract` paragraph in prose** for the prescriptive-must-remain-true case. Forces concreteness without killing adoption. Grok's line: *"A high-quality prose block becomes the contract the moment a future LLM or developer treats it as such."*
5. **Make `pseudo-drift.ts` the trigger for reconciliation sessions, not just staleness flagging.** When drift fires on a file, spawn a focused session showing: (a) source diff, (b) current prose, (c) call graph of impact, (d) hot-file context. Offer three paths: regenerate descriptively, update contractually, or mark `regret` with symptoms. `/pseudocode` becomes the *repair* skill inside these sessions rather than the creation skill. This is the reflex the system is missing.
6. **Build `pseudo_preflight` skill.** Takes a plan markdown, extracts file/function references, runs `impact_analysis` over the union, returns `{ touched_files, touched_methods, impact_union, load_bearing_methods_in_union, regret_methods_in_union, prose_summary_of_union }`. This is the Spec Delta from round 1. Thin — maybe 150 lines.
7. **Add a "ledger view"** that surfaces only methods tagged `@contract`, `manual`, or `regret` — this becomes the architectural decision log without a second store.
8. **Do NOT semantically extend `pseudo-drift.ts`.** Leave it as a freshness checker. Rename our concept of "spec drift" in docs to avoid confusion — the existing file is about bytes, not beliefs.

## The Key Frame Shift

Round 2 concluded: build the mirror, let the ledger grow from attention. Round 3 correction: **pseudo.db is the mirror substrate. Our job is not to build it — it's to close the adoption gap by making drift automatically spawn reconciliation sessions that feel like debugging rather than documentation.**

The wheel exists. It needs to be turned into a reflex instead of a database.

## Grok's Meta-Inference (Worth Pinning)

> *"The existence of pseudo.db — built, comprehensive, and ignored — is the strongest evidence we've had in this entire conversation. It tells us that good ideas about intent tracking are common. Living systems that make the tracking cheaper than drift are rare. Anything else would be ego."*

## My Read

Two concrete first moves, in order:

1. **Investigate the two bugs.** 30 minutes each. If `insertCall` is really writing NULL on v6 with no resolution pass, that's the first fix — impact analysis is the load-bearing primitive everything else depends on. If the prose overlay isn't matching, that's the second — no point building on a silently-failing matcher.

2. **If both check out:** spend one afternoon building the drift-triggered reconciliation session prototype. When `pseudo-drift.ts` fires on any file, instead of just re-scanning, present a compact UI/document: source diff + current prose + impact. If that feels useful *once*, you've earned the rest of the scaffolding (intent_tags, preflight skill, ledger view). If it doesn't feel useful, you've learned the expensive lesson for free.

Everything round 1 and round 2 produced — Decision Ledger, Vibe Anchor, Spec Delta, Current Reality Mirror — folds into this as views and policies on a substrate that already exists. **Build the reflex, not a parallel system.**