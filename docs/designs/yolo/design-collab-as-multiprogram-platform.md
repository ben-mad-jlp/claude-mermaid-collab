# Collab as a Multi-Program Work Substrate

**Status:** Design synthesis (docs-first pass, 2026-06-05). Grounded in three research docs:
`research-yolox-markup`, `research-todo-user-concurrency-model`, `research-program-integration-seam`.

## The thesis

Collab is becoming the **work substrate for all our internal programs** — not a coding tool that happens to draw diagrams. Three programs today/soon:

- **collab itself** — coding (direct, in-repo).
- **bsync** — CAD (build123d-ocp-mcp), via the cross-project seam.
- **yolox-markup** — ML training + image annotation (`~/Code/yolox-markup`).

The unifying claim: every program is the **same work-graph of todos**, executed by either an **agent** (mechanical) or a **human** (judgment/annotation), tracked under one project, gated by a **program-specific acceptance gate**.

This doc separates the vision into **three layers** that should be sequenced, not co-built.

---

## Layer A — yolox-markup as a program (LOW difficulty; the seam already exists)

**Finding:** The collab program seam is *data, not code*. A program plugs in by:
1. Registering its repo (`project-registry.register(path)`).
2. Dropping `<repo>/.collab/project.json` — `profiles` (type, allowedTools, contextPrompt, model, runtimeMode), `pathRules`, `gateCommand`, `metricRefs`.
3. A deterministic **gate-runner** the gate command invokes.
4. (Optional) an MCP server of domain verbs — **yolox-markup already ships `annotator-mcp`, ~30 tools.**
5. Todos that target it via `targetProject=<repo>`.

Nothing in collab core changes. yolox-markup is *additive data + one gate script*.

**What's mechanical (agent/daemon work):** capture/import images, launch & monitor training runs, auto-label (model writes `is_draft=true` annotations), export (`.onnx`/OpenVINO/OAK `.blob`), evaluation (mAP).

**What's human:** see Layer B.

**Open issue inherited from the CAD seam:** yolox-markup deliverables are **binary/large** (images, `*.pth` checkpoints, `.blob` exports — all gitignored). The text-diff change-set gate can't see them. This is the *same* gap as the CAD "Binary artifact (STEP/PNG) gate" todo (`49352848`). yolox-markup should **share** that binary-artifact gate path, not invent its own. Its gate verdict is metric-based: a training todo "passes" on an mAP threshold, an export todo passes on a successful round-trip/load.

---

## Layer B — User (human) todos (MEDIUM difficulty; the keystone)

**Finding:** Today the work-graph is **agent-only**. The Coordinator daemon claims *every* `ready` deps-satisfied todo; `claimedBy` is always the literal `'coordinator'`. There is **no path** for a todo to wait for a human. The only human touchpoints are *escalations* (a decision channel) and *blocked* todos parked after failure — neither is "a work item a person owns and completes."

**Decision (approved):** Model user todos in the **same work-graph**, distinguished by assignee kind — NOT a separate parallel queue.

### Model
```
todo {
  assigneeKind: 'agent' | 'human'      // NEW (default 'agent' — backward compatible)
  assignee:     'agent:<pool-type>' | 'human:<person>'   // person identity = Layer C; until then 'human:unassigned'
  status:       ready                   // same ladder; daemon SKIPS when assigneeKind==='human'
}
```

### The three changes
1. **Schema:** add `assigneeKind` to the todo store (`todo-store.ts`), defaulting `'agent'`. Mirror in `ui/src/types/sessionTodo.ts`.
2. **Coordinator skip-rule:** the claim loop (`coordinator-daemon.ts` / `coordinator-live.ts`) must **not claim** `assigneeKind==='human'` todos. They stay `ready` until a human marks them `in_progress`/`done`. Deps still work: an agent todo can depend on a human todo (train *after* annotation review) and vice-versa.
3. **Human inbox:** a "Your todos" view — list human-assigned `ready` todos for the current project, let a person claim/start/complete them. For yolox-markup the inbox item deep-links into the annotator UI at the right image batch.

### First customer: annotation
- **Annotate batch** → human todo (draw bboxes on `unlabeled` images).
- **Review auto-label drafts** → human todo (accept/undo `is_draft` annotations — the HITL QA gate).
- **Promote to reviewed** → human todo (final sign-off).
- These gate the mechanical training todo via `dependsOn` (don't train until review N done).

The image `status` enum in yolox-markup (`unlabeled → in_progress → complete → reviewed`) is the natural per-image state a human todo wraps at the *batch* level.

### Acceptance for human todos
A human todo's "gate" is the human marking it done + (optionally) a mechanical post-check (e.g. "≥N images now `reviewed`" queried via annotator-mcp). Keep it light: the human IS the judgment gate.

---

## Layer C — Multi-user collab + collision (HIGH difficulty; VISION DOC ONLY this pass)

**Decision (approved):** Write the vision. **Create NO buildable todos.** Gate behind A and B landing.

**Finding — the hard truth:** collab has **no concept of a person.** The unit of identity is always the *session*; `approvedBy` is free-text, `decidedBy` is hard-coded `'human'`, there's no session→person map. The plan-merge harness (`planner-reconcile`) detects collisions by node-overlap and merges — but its deltas carry **no author**, so it cannot tell two users apart or arbitrate between them.

### The vision (not yet a build plan)
1. **Identity primitive** — a `person`/`actor` distinct from a session. A session is *operated by* a person. Thread it through `authorSession`→author-person, `approvedBy`→approver-person, and `assignee` (`human:<person>`).
2. **Author-attributed plan edits** — `planner-reconcile` deltas gain an author. Now a collision between two people's edits is *attributable* and can be surfaced as "Ben and Alex both re-sequenced epic X."
3. **Collision handling** — the open question the user raised: *where* does collision get resolved?
   - **At plan time** (reconcile harness, author-attributed) — for plan-graph edits.
   - **At work time** (the worker / claim layer) — two people's todos touching the same files. This is closer to a merge-conflict and may belong in the worker's gate, not the planner.
   - Likely **both**, at different altitudes. This doc's job is to frame the question, not answer it.
4. **Multi-user planning** — two+ people planning one project concurrently, each with their own collab session, edits merged with attribution.

### Why gate it
Identity touches auth, accounts, every attribution string, and the federation story (currently "vaporware", single HOME server per project). It's a platform commitment, not a feature. A and B deliver real value (annotation orchestration) with **zero** identity work — single-user `human:unassigned` is enough. We design C now so A and B don't paint us into a corner, but we don't build it until the value is pulled.

---

## Sequencing & what stays invariant

1. **A first** (yolox program manifest + share the binary-artifact gate) — proves the substrate claim with a third program.
2. **B next** (assigneeKind + Coordinator skip + human inbox) — unlocks annotation as orchestrated human work; first real "user todo."
3. **C designed-only** — identity vision documented; built later when multi-user value is pulled.

**Invariants preserved:** every work todo belongs to an epic (existing constraint); the work-graph todo (not session memory) is the source of truth per todo; one-red discipline; no new WS event types / no polling where avoidable; reuse-not-rewrite.

**Cross-cutting dependency:** Layer A's binary-artifact gate and the CAD epic's `49352848` are the *same work* — do it once, both programs consume it.

---

## Open questions for discussion
- **Q1:** Does a human todo need its own status (`awaiting_human`) or is `ready` + `assigneeKind` enough? (Leaning: kind is enough; status stays orthogonal.)
- **Q2:** Should the human inbox live in collab's UI, or deep-link into each program's native UI (annotator at port 5182)? (Leaning: collab lists, program renders.)
- **Q3:** Binary-artifact gate — build generic (works for STEP, PNG, .pth, .blob) or per-program? (Leaning: generic handle/metadata + per-program verdict.)
- **Q4 (Layer C):** Is collision a *planner* concern, a *worker* concern, or both? Framed above, unresolved.
