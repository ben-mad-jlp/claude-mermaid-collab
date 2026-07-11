# Shared worker-core — the provider-agnostic discipline engine

Extract the vibe-blueprint+vibe-go RECIPE (the phased state machine from `design-grok-worker-discipline`)
out of any single adapter into ONE shared module every provider's in-process worker uses. grok-own and
the future anthropic worker become THIN adapters that supply only a model factory + provider identity;
the discipline lives once, in worker-core. Canonical requirement: north-star §1.

## The seam — shared vs provider-specific (the whole point)

**SHARED (worker-core) — the discipline, identical across providers:**
- The orchestrator STATE MACHINE: size-gate → research+diagram → implement → verify → self-terminating
  fix-loop → completeness-review → host-authoritative-complete (the recipe).
- `spawnSubloop` primitive — fresh `messages:[]`, restricted toolset, depth-1, host-only; the
  LanguageModel is INJECTED, never hardcoded.
- `TOOL_REGISTRY` + `buildToolset` (capability gating per phase) — incl. the HARVESTED tools
  (Edit/Grep/Glob/Read/bash from opencode v0.3.0, MCP client, retry) + create_diagram/get_diagram.
- Typed handoff Zod schemas (SplitProposal / ResearchFindings / VerifyVerdict / ReviewVerdict).
- Compiled discipline prompts; host helpers (sameSignature, gitDiff, isBehavioral, deadline-partition).
- `runScopedGate` integration + the host-authoritative completion call.
- The INTERCEPTION / OBSERVABILITY hook layer (batteries Tier-2 spine): every tool call → gate veto +
  log + cost ledger → live transcript. (north-star §6)
- transcript / inject (steer) plumbing.

**PROVIDER-SPECIFIC (the adapter, behind the WorkerAgent port) — minimal:**
- `resolveModel(modelId?) → LanguageModel` — the ONLY model-construction code (xai / anthropic / …).
- provider id; conformance detectors/fixtures (pane→booleans).
- ideally NO provider-specific prompt/tool quirks.

## API (dependency-injected, decoupled, testable)
```ts
// src/agent/worker-core/index.ts
interface WorkerCoreDeps {
  resolveModel: (modelId?: string) => LanguageModel;      // adapter injects (xai/anthropic/…)
  modelByPhase?: (phase: SubloopRole) => string | undefined; // per-phase routing (optional)
  // host funnels (the same in-process calls grok-own uses today):
  getTodo; handleWorkerComplete; runScopedGate;
  createDiagram; getDiagram; escalationCreate; awaitHumanDecision;
  hooks: InterceptionHooks;                                // tool.before(veto+log) / tool.after(log+cost)
}
async function runWorkerCore(ctx: WorkerCtx, deps: WorkerCoreDeps): Promise<void>
// ctx = { project, todoId, cwd, lane, abortSignal }
```
The adapter's `WorkerAgent.launch()` spins a lane and calls `runWorkerCore(ctx, deps)`. `deps.resolveModel`
is the only provider-specific injection. Everything else is shared.

## Module layout
```
src/agent/worker-core/
  index.ts      — runWorkerCore orchestrator (the state machine)
  subloop.ts    — spawnSubloop (model injected)
  registry.ts   — TOOL_REGISTRY + buildToolset (capability gating)
  schemas.ts    — typed handoff Zod schemas
  prompts.ts    — compiled discipline prompts
  gate.ts       — runScopedGate (shared with completion-resolver)
  hooks.ts      — interception/observability layer (Tier-2 spine)
  helpers.ts    — sameSignature / gitDiff / isBehavioral / partition
  tools/        — Edit.ts, Grep.ts, Glob.ts, Read.ts, bash.ts  (HARVESTED, opencode v0.3.0)
                  mcp.ts (collab in-process + MCP client), diagram.ts
```

## Adapters become thin shells
- `grok-own.ts`: `GrokOwnHarnessImpl implements WorkerAgent`; `launch()` → `runWorkerCore(ctx, {
  resolveModel: id => xai(id ?? DEFAULT_GROK_MODEL), …})`. Keeps conformance detectors. ~50-100 LOC
  shell instead of 550.
- `anthropic-core.ts` (NEW — the daemon-native Anthropic worker): same shell, `resolveModel: id =>
  anthropic(id)`. Reuses worker-core VERBATIM. This is the in-process replacement for the legacy CLI
  ClaudeCodeAgent.

The `WorkerAgent` port + `registry.ts` are UNCHANGED — worker-core sits BELOW the port as shared
internals; the coordinator still never branches on provider.

## Build it SHARED from the start (not build-in-grok-then-extract)
The "don't abstract until 2 consumers" rule is already satisfied: the recipe is a REQUIREMENT across
providers (north-star §1) and the in-process Anthropic worker is a committed destination, not
speculation — ≥2 consumers are certain. Building worker-core directly avoids the grok-own→extract
churn. (Supersedes `design-grok-worker-discipline` §6's "lift to shared when a 2nd provider lands" —
we now know the 2nd is coming, so build shared up front.)

## Build order (respects parallel-run migration, north-star §8)
1. **Phase 1 floor** (epic a4cadfda) — host-authoritative completion + shared `runScopedGate`, in
   today's grok-own. Runtime-agnostic; ship + drive by hand. (Prereq.)
2. **Harvest tools** into `worker-core/tools/` — `applyEdit` (opencode v0.3.0 replacer cascade,
   uniqueness gate hardened), ripgrep wrapper + read formatter, retry predicates, MCP glue. (See
   `research-opencode-harvest-survey`.)
3. **Build the interception/observability spine** (`hooks.ts`) — the gate-veto + per-call log + cost
   ledger. This is the battery Tier-2 spine; everything routes through it.
4. **Build the state machine** — `subloop.ts` + `index.ts` + `schemas.ts` + `prompts.ts` (the recipe).
5. **grok-own becomes the first thin adapter** over worker-core. PARALLEL-RUN vs today's flat loop;
   verify ≥ equivalent (gate pass, drift, observability) before making it the default grok path.
6. **anthropic-core lands as the 2nd adapter.** PARALLEL-RUN vs the legacy CLI `ClaudeCodeAgent`;
   compare on real todos; retire the CLI worker ONLY on proof (north-star §8).
7. Then per-phase model routing (`modelByPhase`) + the Opus/Sonnet/Haiku tier matrix (evidence-gated).

## Where the prior work plugs in
- **Observability (north-star §6)** = `hooks.ts`. Every tool call/result/cost flows through it →
  live transcript + model-call ledger + routing visibility. No black box.
- **Harvest (research-opencode-harvest-survey)** = `worker-core/tools/`. One home for the lifted
  opencode modules, used by every provider.
- **Test-as-spec (bakeoff)** = the research/blueprint phase authors the tests; verify runs THEM →
  drift caught mechanically. Wired into the prompts + the gate.
- **Phase-routing hybrid (bakeoff)** = `modelByPhase` — Opus/Sonnet plan+review, cheap model implement.

## Net
One discipline engine, many thin provider shells. The recipe is written ONCE, observable, harvested
where it makes sense, and re-pointable to any provider/model per phase. grok-own and anthropic-core
are ~100-LOC adapters over a shared core — which is exactly "daemon-native for all providers" made real.
