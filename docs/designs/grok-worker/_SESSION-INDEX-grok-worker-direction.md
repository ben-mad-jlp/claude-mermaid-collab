# Session index — grok-worker discipline direction (2026-06-15)

Reorientation map for this investigation. Read top-to-bottom to resume. Everything here is
DESIGN/RESEARCH — nothing is built yet; epic `a4cadfda` is `planned` (not promoted), daemon off.

## The question
Can the vibe-blueprint+vibe-go discipline live in the provider-agnostic (grok/Vercel) worker — and
should we build our own harness, adopt opencode, or route models per phase? User vision: todos stay
HIGH-LEVEL; the worker internally blueprints + fans out per-file coders.

## North star
- **design-worker-core** — the provider-agnostic discipline ENGINE: extract the vibe recipe into a
  shared `src/agent/worker-core/` every provider uses; grok-own + anthropic-core become ~100-LOC thin
  adapters injecting only `resolveModel()`. Shared = state machine + spawnSubloop + tools (harvested) +
  schemas + prompts + gate + observability hooks; adapter = the model factory. Build shared from the
  start (≥2 consumers certain). Tracked: todo under epic a4cadfda, depends on Phase 1.

- **design-northstar-worker-fabric** — THE whole-picture target: configurable provider/model per
  phase (role × difficulty × autonomy-level → {provider, model}); runtime follows config (native
  Agent() for Anthropic, AI-SDK/opencode for others); epic=branch + todo=lane-worktree; scale as a
  dial; host-authoritative + test-as-spec invariants. Read this first for the destination.

## Build inputs
- **design-daemon-worker-batteries** — which Claude Code batteries to rebuild into the in-process
  worker (Tier 1: real Edit/Grep/Glob/Read tools + per-phase capability model; Tier 2 SPINE:
  pre/post-tool interception = gate + observability + policy in one; Tier 3: MCP client, prompt
  caching, bash sandbox, retry; Tier 4: playbook mechanism) + what NOT to rebuild (work-graph beats
  TodoWrite). Build Tier-1.1 + Tier-2 first.
- **research-opencode-harvest-survey** — per-battery build-vs-harvest plan. HARVEST from opencode tag
  `v0.3.0` (pre-Effect; latest is Effect-coupled — bad source). Clean-lift FIRST: `tool/edit.ts`
  replacer cascade → `applyEdit()`, `session/retry.ts` predicates, ripgrep+read formatter, v0.3.0
  `mcp/index.ts`. Reference-only: provider resolver + models.dev, tool-interception two-hook shape,
  shell→permission gating. MIT (preserve LICENSE + attribution). TRAP: harden the edit uniqueness gate
  across all replacers (upstream bugs #1261/#2433).

## Artifacts (in order)
1. **research-opencode-vs-own-harness** — first pass: don't embed opencode; keep our loop + go multi-provider.
2. **design-grok-worker-discipline** — design-exploration winner: "deterministic-harness, model-as-leaf"
   (fresh generateText sub-loop per phase = fresh-context agent; blueprint+go survives without Agent()).
3. **consult-grok-worker-discipline** — Grok skeptical review + synthesis: ship Phase-1 floor; fresh-context
   verify is the high-value increment; full pipeline evidence-gated.
4. **research-opencode-plugin-feasibility** — opencode deep dive: GO-but-gated (tool.execute.before veto,
   child-session verify, directory isolation) BUT plugin API has no stability contract. Pinned spike to decide.
5. **bakeoff-phase1-blueprints** — THE empirical core. grok-build-0.1 vs Opus:
   - Quick cut (hand-fed, concrete refactor): grok ~matched Opus (46 vs 48).
   - Faithful cut (self-gather, abstract task): grok BROKE — missed the core ask + drifted. Breaking point
     = task ABSTRACTION, not navigation.
   - Implementation cut (Opus blueprint → grok builds → Opus review): tsc+tests GREEN, but grok silently
     drifted from spec AND wrote its own tests to match → green gate blind. Opus review caught it.

## Conclusions (current best, will be re-run/iterated)
- Own-harness on grok is VIABLE for CONCRETE leaves. Keep todos concrete (durable contract at filing =
  files + before/after behavioral spec). Architectural framing stays with the planner.
- **Phase-routing hybrid VALIDATED:** strong model = blueprint + AUTHOR TESTS + review; grok-build = implement.
- **TEST-AS-SPEC anti-drift rule:** blueprint authors the tests (executable spec); implementer passes THOSE,
  cannot weaken them → drift caught mechanically; model-review for semantic/architectural gaps only.
- Completion host-authoritative (no model "done" tool); workers never fan writers into a shared tree.
- opencode not specifically favored — its wins (multi-provider/subscription/UI/maintained loop) are all
  buildable on our own harness; the plugin-instability risk is real. Decide via pinned spike.

## OPEN — model tiering per phase/level (to test next)
Proposed default matrix (UNVALIDATED — fill in by re-running the bakeoff harness per phase/difficulty):

| Phase | Default | Escalate to | Note |
|---|---|---|---|
| Blueprint | Sonnet | Opus (hard/novel architecture) | grok-build failed here; Sonnet is vibe-go's workhorse |
| Author tests (exec spec) | Sonnet | — | concrete |
| Implement | grok-build | Sonnet (complex/drifty leaf) | cheap volume; proven on concrete leaves |
| Review vs spec | deterministic check → Sonnet | Opus (architectural) | test-gate catches most drift FREE first |

Prior: vibe-go already runs "Sonnet throughout" for research/implement/verify/fix. The measurement tool
is the bakeoff ReAct loop (reusable across models/phases/tasks).

## Work-graph
Epic `a4cadfda` — [Phase 1 host-authoritative completion + shared gate `b43ce046`] · [opencode spike
`37777dee`] · [DECISION runtime `45ec3e67`] · [LAND `1c03af5b`]. All `planned`. Constraint `3c75066c`
(host-authoritative completion + no shared-tree writer fan-out) proposed, needs approval. Decision
`924a70bf` (incremental adoption) active.
