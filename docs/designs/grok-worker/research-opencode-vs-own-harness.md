# Embed opencode vs. keep GrokOwnHarness — research + decision

**Question:** Did we miss the boat rejecting a CLI agent? Should we fork/embed
**opencode** (sst/opencode, MIT, TS/Bun) and inject collab into it — gaining
model-switching (not grok-locked), at the cost of vendor subscriptions?

**Short answer: No — but the instinct points at a real, cheap win.** Don't adopt
opencode. Do make our *existing* harness multi-provider. (Option 3 below.)

---

## What we have today (ground truth)
`GrokOwnHarness` — `src/agent/adapters/grok-own.ts`, ~550 LOC:
- In-process Vercel AI SDK loop: `generateText` + `xai('grok-build-0.1')`, step cap 50, 15-min deadline.
- Tools (`get_todo/complete_todo/write_file/read_file/run_bash`) call the coordinator
  **directly in-process** (dynamic import to dodge a cycle). **Completion is never
  trusted from the model** — `complete_todo` runs the server-side mechanical gate.
- Liveness = loop-promise state. Human steer = `prepareStep` inject at step boundaries.
- Clean port already exists: `WorkerAgent` interface (`worker-agent.ts`), registry routes
  by `ProviderId` (`'claude' | 'grok-build' | 'codex'`), coordinator never branches on provider.

## What opencode actually is (research)
- TS/Bun, MIT, ~175k stars, weekly releases (SST/anomaly).
- **Same core as us**: Vercel AI SDK + models.dev under the hood.
- Headless HTTP server (`opencode serve`) + typed SDK (`createOpencode()` spawns+drives
  in-process, `event.subscribe()` SSE). **No fork needed** — native MCP (plug collab via
  config), in-process TS plugin API + 30+ loop hooks (`tool.execute.before/after`,
  `permission.asked`, `session.idle`…).
- xAI **device-code headless flow** → SuperGrok *subscription* auth, not just API key.
  (This directly answers the "we'd lose subscriptions" worry — but see synthesis.)

## The appeal (steelman)
Stop maintaining our own loop; get model-switching + subscription auth + a very active
upstream "for free." Ride a maintained project instead of hand-rolling.

---

## Grok skeptical review — synthesis (ACCEPT / TEMPER / DISCOUNT)

**ACCEPT — the core verdict.** For a *local-first, single-user* worker whose entire
value is a narrow, server-gated, one-todo execution surface, our 550 LOC is a **feature,
not a liability**. It's the minimal surface that makes our invariants trivial: direct
in-process coordinator calls, server-authoritative completion, exact `prepareStep`
injection, worktree isolation. Embedding opencode trades a small codebase we fully
understand for a large, weekly-moving runtime we don't control — the maintenance doesn't
disappear, it relocates into a glue layer whose semantics *they* define on *their* cadence.
Classic framework seduction.

**ACCEPT — dependency churn is mismatched to our shipping model.** We're an installed
Electron app, not a service we redeploy at will. Every opencode breaking change becomes a
user-facing compat problem. We'd be doing integration work on their release schedule.

**ACCEPT — model-switching is low-value for THIS workload.** "Execute one todo, pass a
mechanical gate" rewards tool-calling reliability + instruction-following, not raw IQ or a
75-provider menu. Each model has different failure modes on `run_bash`/git-worktree
discipline that we'd have to characterize per-model anyway. "75+ providers" is a chat
selling point.

**TEMPER — "completion authority erodes."** Grok overstates this slightly. Our gate runs
**server-side regardless of harness** — even under opencode, `complete_todo` would be a
*request* and the gate still adjudicates. What genuinely erodes is the *cleanliness*: today
it's a direct function call; under opencode it's "call our coordinator from inside one of
their hooks." Real cost, but it's coupling/latency, not loss of authority per se.

**TEMPER — subscription auth.** The one concrete thing opencode hands us that Option 3
doesn't is the xAI device-code subscription flow. But (a) the user themselves suspects
subscription billing fades for real autonomous work; (b) we can implement device-code
ourselves if it ever matters; (c) API-key billing for headless workers is fine and
predictable. Not worth adopting a runtime for.

**DISCOUNT — "attack surface / TCB" framing.** Valid in principle but low-stakes at
single-user local scale; not a deciding factor here.

---

## Recommendation: Option 3 — keep the loop, make the model layer multi-provider

We are *already* on the Vercel AI SDK. Getting model choice is a scoped, reversible change:
1. Replace the hardcoded `xai('grok-build-0.1')` with a small **provider resolver** that
   maps `ProviderId`/model string → AI SDK `LanguageModel` (`@ai-sdk/xai`,
   `@ai-sdk/anthropic`, openai-compatible/local). The `WorkerAgent` port + registry seam
   for this **already exists**.
2. Keep everything that makes the worker good: in-process coordinator tools,
   server-authoritative gate, `prepareStep` injection, loop-promise liveness, worktree isolation.
3. (Optional, only if needed) per-provider tool/prompt conditioning, since tool-calling
   discipline differs across models.

This delivers the **only** clearly-good part of the opencode idea (not being grok-locked)
**without** adopting the runtime, the dependency churn, or the boundary erosion.

### Risk ranking (lifted from review, our scale)
1. Loss of clean completion semantics (highest) — Option 3 avoids entirely.
2. Dependency churn / integration debt — Option 3 avoids entirely.
3. Steering/observability precision loss — Option 3 preserves in-process precision.
4. Over-abstraction for the workload — Option 3 stays minimal.

### What would flip this decision (revisit triggers)
- We start needing a **rich worker UI / TUI** we don't want to build (opencode ships one).
- Workers become **general/exploratory chat agents**, not one-todo gated executors.
- We want to run workers **out-of-process on remote boxes** at fleet scale (opencode's
  server model would earn its keep).
- xAI subscription economics become decisively cheaper than API and device-code is painful
  to self-implement.

**None hold today → keep GrokOwnHarness, add the multi-provider model resolver.**
