# North-star: the configurable worker fabric

The whole picture for autonomous todo execution. This is the DESTINATION the incremental work
(epic `a4cadfda`) climbs toward — not a commitment to build it all at once. Evidence behind every
claim: see `_SESSION-INDEX-grok-worker-direction` and the bakeoff/research/design docs it links.

---

## 1. The layering (planner over daemon over worker over phase)

```
Human + Planner session (strong model)         ← judgment about WHAT
  └─ makes EPICS + TODOS = durable contracts (files + before/after spec + tests)
  └─ promotes ready (the only promoter)
        │
   Daemon (deterministic execution layer)        ← the HOW, no judgment
   └─ claims ready todos, wave-schedules by deps, spawns one worker per todo
        │
     Worker = per-todo phased pipeline            ← model-routed execution
     └─ blueprint-refine → implement → verify → (review)
        each PHASE runs on a CONFIGURABLE (provider, model)
```

This is the existing PCS invariant (planner-promotes-ready / daemon-fans-out), extended with
per-phase model routing BELOW the planner line. The planner decides what; the fabric executes how.

### REQUIRED: every in-process worker runs the vibe-blueprint + vibe-go RECIPE
This is a hard requirement on EVERY provider's daemon worker (not a grok-only detail — the recipe is
the discipline, the model is just the leaf). The worker is NOT a single flat loop; it is a host-owned
state machine that runs these phases per todo, with FRESH context per phase and only typed objects
crossing phase boundaries:
1. **Size-gate** → if oversized, file a split-proposal; the PLANNER promotes siblings (worker never
   spawns writers, stays single-todo).
2. **Research → before/after diagram-as-spec** — the per-todo blueprint; the diagram is the contract
   verify/review judge against.
3. **Implement** (sees only the typed research findings, not scrollback).
4. **Verify** (fresh context; judges the change-set against the diagram, independent of implement).
5. **Self-terminating fix loop** — same errors twice → escalate, never grind.
6. **Completeness review** (Step 3.5; behavioral leaves only; read-only; skip trivial).
7. **Host-authoritative completion** — host runs the scoped gate + work-committed check and records
   done; the model has no "done" tool.

vibe-BLUEPRINT lives at TWO levels, both required: the PLANNER decomposes goal → epic → todos (the
task graph); the WORKER does the per-todo blueprint (research + diagram + per-file fan-out inside its
worktree). vibe-GO's per-task chain IS phases 2-6 above. Full construct-level realization +
execution trace: see `design-grok-worker-discipline` (§3 trace, §4 step→construct table) — to be
GENERALIZED from grok-own.ts to a shared in-process worker used by every provider adapter.

## 2. Configurable provider/model per phase — the core abstraction

A config map is the single place tiering is expressed:

```
route: role/phase × difficulty × autonomy-level → { provider, model }
```

- Subsumes the grok-vs-Haiku-vs-opencode debate: you don't PICK a model, you CONFIGURE it. Any
  provider (anthropic / xai / codex / local), any model, per phase.
- The `WorkerAgent` port (ProviderId → adapter) + a `resolveModel(provider, modelId)` resolver are
  the seam. The config is where the human sets the tiers and scales them per autonomy level.
- The DISCIPLINE is constant regardless of routing: concrete leaves, test-as-spec, independent
  review. (Bakeoff: cheap models drift on ABSTRACT work no matter which one — routing doesn't fix
  that, discipline does.)

### Default tier matrix (UNVALIDATED — fill by re-running the bakeoff harness per cell)
| Phase | Default | Escalate to | Why |
|---|---|---|---|
| Blueprint | Sonnet | Opus (hard/novel architecture) | grok-build broke here; Sonnet = vibe-go workhorse |
| Author tests (exec spec) | Sonnet | — | concrete |
| Implement | Haiku **or** grok-build (TEST both) | Sonnet (complex/drifty leaf) | cheap volume |
| Review vs spec | deterministic test-gate → Sonnet | Opus (architectural) | test-gate catches most drift FREE |

Per-level scaling: at `build` (human watches) run cheaper; at `drive` (auto-land, no human)
escalate the REVIEW tier — the safety net is gone, so the model must be the backstop.

## 3. Runtime: daemon-native (in-process) for ALL providers — the CLI worker is LEGACY

DESTINATION: the worker runs IN THE DAEMON, in-process (the AI-SDK loop shape of GrokOwnHarness), for
EVERY provider — Anthropic via @ai-sdk/anthropic, xai via @ai-sdk/xai, codex/local likewise. Even an
Anthropic-model worker does NOT run in Claude Code. The phase pipeline (blueprint/implement/verify
sub-loops) is in-process for everyone — uniform, which is precisely what delivers the typed,
logged, cost-ledgered observability of section 6. (A CLI/tmux session is pane-scraped and semi-opaque
— the opposite of the no-black-box requirement.)

- **TODAY (legacy):** the Anthropic worker = `ClaudeCodeAgent` — spawns the `claude` CLI in tmux,
  binds /collab, runs the worker skill. Batteries-included (skills, native Agent(), Read/Edit/Grep)
  but semi-opaque and CLI-bound. This is what we MIGRATE OFF — not the destination.
- **DESTINATION:** an in-process AnthropicHarness (generalize GrokOwnHarness) behind the same
  WorkerAgent port. The discipline becomes CODE (deterministic-harness/model-as-leaf), not a CLI skill
  prompt, for ALL providers.
- **Known cost (stated honestly):** going in-process for Anthropic gives up Claude Code's
  batteries — skills, the native Agent() tool, the mature tool ecosystem — and we rebuild the phase
  discipline as code. Accepted: it buys uniform observability + provider-swap + host control.

Correction to an earlier draft: "Anthropic = native Agent(), no harness; the in-process rebuild was
grok-specific" was WRONG. The in-process pipeline is the runtime for EVERYONE; the CLI path is the
thing being retired.

**Provider swap is PERMANENT — never removed, never deferred.** The `WorkerAgent` port + model
resolver are load-bearing seams that always exist; ANY phase can be re-pointed to ANY provider at ANY
time via config. "Runtime follows config" governs which adapter is ACTIVE for a given config — it does
NOT make multi-provider optional. The native Claude/Agent() path is the *cheapest active runtime when
every phase happens to be Anthropic*; the moment a phase is re-pointed elsewhere, its adapter is live.
Swappability is a requirement, not a someday-feature: we build the seam first and keep it forever.

opencode's standing: GO-but-gated. It can host the discipline (tool.execute.before veto = host-
authoritative completion; child sessions = fresh-context verify; directory = isolation) but its
plugin API has NO stability contract. It's ONE possible non-Anthropic adapter behind the port —
never the only path. Decide via a pinned spike if/when a non-Anthropic phase is actually wanted.

## 4. Isolation: epic = branch, todo = lane worktree

- **Each epic = its own accumulation branch** (`collab/epic/<id8>`) → isolated, independently
  RELEASABLE (its LAND leaf merges it to master on its own).
- **Each todo = its own lane worktree** branched off the epic branch → per-todo isolation; the gate
  scopes to the lane's worktree diff so SIBLING todos don't contaminate each other.
- Do NOT coarsen to one shared worktree per epic: parallel sibling todos would see each other's
  in-flight edits and re-open the cross-lane contamination the lane-worktree design fixed. "Each
  epic its own worktree" is satisfied at the BRANCH level; lanes are sub-worktrees off it.

## 5. Scale is a DIAL, not a default (this is how control + throughput coexist)

The same fabric runs "one todo, hand-driven, watched" AND "fifty epics in flight." Three knobs:
- **Pool size** — how many workers run at once.
- **Autonomy level** (off · build · nudge · propose · drive) — build = human watches each card;
  drive = auto-land, no human. Durable `orchestrator_off` is the kill switch.
- **Model tier** — cheap models (Haiku/grok) make mass parallelism AFFORDABLE.

"Release a lot, do a lot at once" = crank the knobs. "Don't lose control" = leave them low. You opt
INTO scale; it's never forced. Cheap-makes-it-affordable, the autonomy ladder makes-it-safe.

## 6. Observability is a FIRST-CLASS invariant — collab baked in, NOT a black box

The daemon must be MORE visible than an interactive session, not less — precisely because no human
is in each loop. Visibility IS control; it is what makes scaling autonomy safe. A "deterministic
daemon" is NEVER an excuse for opacity. Collab is the pane of glass and EVERY low-level thing the
fabric does renders into it. This is a build requirement on every component, not a later dashboard.

What MUST be visible + logged (collab-native, typed, queryable — not buried in stdout):
- **The task graph, live** — epics/todos/deps/status (planned→ready→in_progress→done), claims,
  gate verdicts, in real time. The graph is the source-of-truth view, already WS-driven; the daemon
  feeds it, never bypasses it.
- **Per-phase transcripts, every provider** — the worker transcript (steps, tool calls, tool
  results) rendered in the UI for EVERY phase and EVERY provider, not just grok lanes. (Generalize
  /api/worker-transcript + GrokTranscript into a provider-neutral transcript surface.)
- **Routing decisions** — for each todo+phase, WHICH (provider, model) ran, and WHY (the config cell
  that selected it). You can SEE that blueprint=sonnet, implement=haiku, etc., per todo.
- **A model-call ledger** — provider, model, phase, tokens, latency, COST per call. This is what makes
  the tier matrix tunable (cost-per-correct-completion, not guesses) and what keeps spend visible.
- **Every tool call + edit** — read/write/bash, the diff produced, the commit. The before/after
  diagram-as-spec posted to the collab tree so the PLAN is visible, not only the result.
- **Worktree/branch state** — which epic branch, which lane worktree, what's committed vs pending.
- **Gate + review verdicts** — pass/fail + reasons, surfaced; escalations as cards (already exists).
- **Event stream / audit** — an append-only, queryable log of every fabric decision, replayable.

Litmus test: at any moment a human can open collab and answer "what is every worker doing, on what
model, at what cost, against what spec, with what result?" WITHOUT reading a server log. If a feature
can't answer that, it isn't done.

## 7. Durable invariants (hold across every config)
- Provider/model SWAP is permanent — the WorkerAgent port + resolver always exist; any phase
  re-points to any provider at any time. Multi-provider is a requirement, never deferred or removed.
- Completion is HOST-AUTHORITATIVE — no model-callable "done" tool; the host runs the scoped gate
  and records completion. (Phase 1 builds this floor, runtime-agnostic.)
- Workers never fan writers into a SHARED tree; per-file/per-phase sub-work stays inside the todo's
  own worktree.
- TEST-AS-SPEC: the blueprint phase AUTHORS the tests; the implementer passes THOSE, can't weaken
  them → drift caught mechanically; model-review reserved for semantic/architectural gaps.
- OBSERVABILITY is non-negotiable — every fabric action is collab-visible, logged, and replayable
  (section 6). No black boxes, ever.
- The vibe-blueprint + vibe-go RECIPE is required of EVERY in-process worker (§1) — a host-owned
  phased state machine (size-gate → research+diagram → implement → verify → fix-loop → review →
  host-complete), fresh context per phase, typed handoffs. Not a flat loop; not grok-only.
- PARALLEL-RUN migration — the legacy CLI worker and the new in-process harness coexist behind the
  WorkerAgent port; never tear down the old until the new is built AND verified (section 8).
- Discipline is constant; only routing is configurable.

## 8. Migration discipline — parallel-run, verify-before-retire (strangler-fig)

HARD RULE: both runtimes must work during the transition. We do NOT rip out the working Claude-CLI
worker to build the daemon-native one — we run them side by side and cut over only on proof.

- The `WorkerAgent` port already enables this: `ClaudeCodeAgent` (CLI/tmux) and `GrokOwnHarness`
  (in-process) coexist TODAY, routed by `ProviderId`. The new in-process **AnthropicHarness** lands as
  a parallel adapter behind the SAME port.
- **Route + compare:** send real todos to both runtimes; compare outcomes (gate pass, drift, cost,
  observability completeness) on identical work. The model-call ledger + transcripts (section 6) are
  what make the comparison objective, not anecdotal.
- **Retire on proof only:** the legacy CLI `ClaudeCodeAgent` is removed ONLY after the in-process
  Anthropic worker is verified at least equivalent on a real workload. Until then it stays the default
  for Anthropic todos.
- Applies to every cutover, not just this one: build new behind the port → run parallel → verify →
  flip the route → retire old. No big-bang replacements.

## 9. How we get there (incremental, evidence-gated — NOT all at once)
1. **Phase 1** (epic `a4cadfda`): host-authoritative completion + shared scoped gate. Runtime-agnostic
   floor under everything above. Ship + drive one worker by hand.
2. **Measure the tier matrix**: re-run the bakeoff ReAct harness per cell (start: Haiku vs grok-build
   on implement; Sonnet vs Opus on blueprint). Fill the scoreboard with evidence.
3. **Wire per-phase model routing** on the simplest runtime that fits the chosen tiers (Anthropic-only
   → native Agent() pipeline; else the AI-SDK adapter).
4. **opencode spike** only if a non-Anthropic phase is actually wanted.
5. Raise the dials (pool/level) as trust accrues.

Expect to RE-RUN this whole investigation as models change — the bakeoff harness is the reusable
measurement tool; this doc is the living target.
