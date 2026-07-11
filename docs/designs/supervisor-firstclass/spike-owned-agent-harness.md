# Spike: Owned Agent Harness — Kill the tmux pane-scrape dance

**Date:** 2026-06-11 · **Author:** Lead Architect (supervisor-firstclass) · **Status:** Recommendation

---

## 1. VERDICT

**Build THIN on the Vercel AI SDK (option b).** Do NOT fork opencode; do NOT keep driving vendor CLIs for the Grok lane.

Wrap the AI SDK's built-in tool-calling loop (`generateText`/`ToolLoopAgent` + `stopWhen`) plus our existing MCP server's tools (via `createMCPClient`) into a single `OwnHarnessAgent` adapter (~300–500 LOC) behind the planned `WorkerAgent` port. **opencode is itself a thin app built on the Vercel AI SDK** — forking it means inheriting a whole TUI + client/server + SQLite-session + provider-registry product we explicitly do not want ("least machinery, no plugin marketplace"), and re-introduces an opaque subprocess-over-HTTP boundary — the same opaqueness we're paying to remove, just HTTP instead of tmux. The AI SDK gives us exactly the loop primitive and nothing else, runs native as a library in the Bun/TS sidecar, and lets the sidecar own completion + the acceptance gate directly. Use opencode only as a reference implementation, not a base.

---

## 2. Capability comparison

| Dimension | Vercel AI SDK (THIN) ✅ | opencode (fork/drive) | Block Goose (best other) |
|---|---|---|---|
| **Headless / embeddable** | Library — `import` into the Bun sidecar, in-process, no subprocess | Headless `serve` (OpenAPI+SSE) + `@opencode-ai/sdk`, but it's a product, not a lib | Rust CLI/desktop, headless CLI mode |
| **Providers incl. Grok** | `@ai-sdk/xai` (Grok), `@ai-sdk/anthropic`, `@ai-sdk/openai`, local — one-line swap | 75+ via models.dev (uses AI SDK underneath) | Anthropic/OpenAI/Bedrock/local |
| **MCP** | `createMCPClient` — stdio/SSE/HTTP; pulls our MCP tools as native tools | Yes (own MCP/tool model to bridge) | Native MCP |
| **Agent loop built-in** | Yes — `ToolLoopAgent`/`generateText` w/ `stopWhen`, default 20 steps, `prepareStep` | Yes (its own loop, opaque to us) | Yes (batteries-included) |
| **Auth modes** | Metered API keys only (no OAuth) | API key + subscription OAuth (Claude OAuth now ToS-blocked) | API keys |
| **License** | MIT/Apache (npm packages) | MIT | Apache-2.0 |
| **Fork/maintenance burden** | Pin `ai` + `@ai-sdk/xai`; you own ~6 small tools | Track a fast-moving 13k-commit product repo | Rust toolchain friction vs Bun/TS sidecar |
| **Bun/TS fit** | Native — plain TS npm, runs in Bun | Bun-based but a product to embed | Rust — friction against our sidecar |

(Vercel "Bun.serve unsupported" note is a Vercel-Functions *deployment* caveat — irrelevant; we `import` the SDK, not deploy to Vercel.)

---

## 3. Auth / economics finding (the crux — premise has shifted since Jan-2026)

**Owned harness ⇒ metered billing for EVERY provider. There is no flat-rate-subscription loophole for automation left on any of the three.**

- **Anthropic:** (1) Feb 2026 — using Pro/Max OAuth tokens in any third-party tool/harness (incl. the Agent SDK) is **prohibited** and server-blocked. (2) Effective **June 15 2026** — `claude -p` headless, Agent SDK, GitHub Actions, and third-party-subscription-auth move to a **separate metered credit pool at full API list rates** (Pro $20 / Max-5x $100 / Max-20x $200, then overflow). **Only *interactive* Claude Code in a terminal/IDE still draws the flat subscription.** So owning the Claude loop = metered Opus (~$25/M out) — expensive for output-dominated coding. You can have cheap+opaque (interactive CLI) OR owned+metered, not both.
- **xAI/Grok:** API-first, **no subscription to arbitrage** (SuperGrok/Heavy/Grok-Build-CLI are consumer/CLI-bound chat products). Metered API was always the only build path — and it's cheap. `grok-code-fast-1` **retired May 15 2026** (redirects to Grok 4.3). Current targets: **Grok 4.3** ~$1.25/$2.50 per M in/out (cached in $0.20/M); **grok-build-0.1** (agentic-coding, ~May 2026) ~$1/$2 per M, 256K ctx. ~10x under Opus output. The originally quoted $0.20/$1.50 SKU no longer exists — re-baseline budgets on Grok 4.3 / grok-build-0.1.

**The split, justified:**
- **GROK → owned harness (AI SDK), metered API.** Cheap, legally clean, we own the loop. This is the high-volume, output-dominated worker lane where metered Opus would hurt and where the scrape-tax is pure waste.
- **CLAUDE → stays vendor CLI on subscription — but ONLY for *interactive* low-volume judgment roles** (steward, per-project planners using `--remote-control`). Automation-driven Claude is metered regardless of harness, so tmux-scraping buys Claude **no** economic advantage going forward — flagged for a later `ClaudeAgentSdkWorker` (Agent SDK TS) to kill that scrape too, billing unchanged.

UNCERTAIN: exact live Grok coding slug/price (changing fast — verify at docs.x.ai before wiring); the >200K-ctx surcharge (aggregator-reported, not confirmed verbatim from xAI).

---

## 4. Grok coding-quality evidence → cheap-leaf / hard-leaf routing

- **No neutral audited head-to-head exists for grok-build-0.1** (xAI has not published SWE-bench Verified for it). The circulating 70.8% SWE-bench figure is the **retired** grok-code-fast-1 — do not attribute it to grok-build-0.1.
- Vendor-reported reference points (harness-dependent, not comparable): Codex/GPT-5.5 ~88.7%, Claude Code/Opus ~87.6%, grok-code-fast-1 ~70.8%.
- Practitioner signal: grok-code-fast was **fast + cheap + good-enough for well-scoped tasks**, weaker on long-horizon multi-file autonomy. Grok Build adds Plan Mode + parallel subagents but is **early beta, unproven in production**.

**Routing implication:** "Grok for cheap/parallel well-scoped leaves, Claude for hard long-horizon leaves" is a **defensible default on cost+speed logic, NOT a proven quality tier.** Validate it against our own deterministic acceptance-gate pass-rates per todo type before hard-coding the split. CAD/geometry workers: test Grok against the geometry gate before moving them.

---

## 5. How it slots into the WorkerAgent port

**Port shape:**
```ts
interface WorkerAgent { start(opts:{todo;cwd;profile;mcp}): AgentHandle; }
interface AgentHandle {
  events: AsyncIterable<AgentEvent>;  // ready|step|toolcall|permission|done|error|rate_limited
  status(): 'starting'|'running'|'done'|'failed';
  abort(): void;
}
```

**Scrape seams that VANISH (5 of 6 deleted outright):**

| Seam | Today (scrape) | Owned harness |
|---|---|---|
| Readiness | poll pane 60s for status bar (`isTuiReady`) | DISAPPEARS — `await start()` resolved = ready |
| Permission-prompt | regex pane, extract gated tool, nudge | DISAPPEARS — we own the tool-exec callback; grant/deny in-code |
| Stall / idle | unchanged-pane diff + backoff + nudge | DISAPPEARS → deterministic step/wall-clock timeout (`stopWhen` + deadline) |
| Rate-limit | pane regex + nudge ladder | DISAPPEARS → SDK throws typed 429; catch → backoff in code |
| Liveness (PID) | `ps` for `claude` in pane subtree | DISAPPEARS (in-process) — crash = promise rejection |
| Completion | worker calls `complete_todo` MCP | CHANGES → structured `done` event |

**Completion — hybrid (recommended):**
- **Option B for the verdict:** on loop `done`, the **sidecar** runs `runRegistryGate` (`gate-runner.ts:121`) on the change-set and calls `handleWorkerComplete(makeCoordinatorDeps(), project, todoId, verdict)` directly — no round-trip trusting the model to self-report. Kills the "phantom accept" class (the reason BP0 stranded-accept reversal exists). The clean seam already exists: `complete_todo` in `setup.ts:4684` delegates to the pure `handleWorkerComplete(...)`; the worker being a TUI was never load-bearing.
- **Option A for working tools:** load our MCP server via `createMCPClient` so the Grok agent has the same capability surface (`get_todo`, `escalation_create`, design/diagram verbs). Zero change to `src/mcp/setup.ts`.

**Embedded vs subprocess:** **In-process for the agent loop** (HTTP to xAI is I/O-bound — biggest win against the fork-EAGAIN proc cap, since today each worker is a heavyweight `claude` process tree), **but exec tools (Bash/git) as short-lived subprocesses with explicit cwd.** Wrap each worker loop in a hard try/catch + per-worker deadline so one bad loop can't wobble the always-on Orchestrator daemon (the one fault-isolation gap of in-process).

**Worktree isolation:** unchanged and already harness-agnostic — `WorktreeManager.ensure()` returns a `path`; nothing assumes a process or TUI. Hard requirement: **cwd-per-worker**. In-process workers must thread `cwd` explicitly on every tool/exec call (never `process.chdir()` — process-global, unsafe under concurrency). Under `workerIsolationEnabled()` keep-warm reuse is already dropped, so every Grok worker is a fresh worktree per todo — perfectly compatible.

**Launch seam:** add `harness: 'own-grok' | 'claude-cli'` to `AgentProfile`; `launchWorker` (`coordinator-live.ts:942`) already resolves a profile per todo — one branch. `detectStalls`/liveness/rate-limit pane code is skipped for own-grok lanes (now loop-internal), runs only for remaining Claude-CLI lanes.

---

## 6. PHASE-0 SPIKE (concrete)

**One real ready leaf, end-to-end, no daemon, no port abstraction yet.** Standalone Bun script `spike/grok-worker.ts`:

1. Input: one real **ready leaf** id + the repo.
2. `WorktreeManager.ensure(sessionId)` → fresh worktree (proves isolation).
3. `createMCPClient` (stdio) against the running MCP server; `mcp.tools()` → assert `complete_todo` + `get_todo` present (proves MCP-as-tools, Option A).
4. `generateText({ model: xai('grok-4.3'), tools: {...mcpTools, ...bashTool(cwd)}, stopWhen: stepCountIs(40) })` with Bash hard-scoped to `worktree.path` (proves loop + cwd discipline). `onStepFinish` → emit structured events; catch 429 → `rate_limited`.
5. On `done`: sidecar runs `runRegistryGate` on the change-set, then `handleWorkerComplete(makeCoordinatorDeps(), project, todoId, verdict)` (proves Option B + gate wiring).
6. Assert: a `Collab-Todo` commit is on the epic branch (`todoOnEpicBranch`) and the todo is `done+accepted`.

**Success oracle:** the leaf goes **green via Grok, gated, with ZERO pane-scraping, ZERO tmux, ZERO `claude -p`.** If it runs, every "DISAPPEARS" claim is proven; remaining work is just the adapter + the one `launchWorker` branch.

**Effort:** ~1–2 focused days for the spike script (loop is free; the fiddly bits are the edit-matching tool and threading cwd). The full adapter + routing field + branch is SMALL–MEDIUM on top.

**De-risks:** (a) MCP tools resolve in-process against our server without a readiness race; (b) the gate/`handleWorkerComplete` seam works driven by the sidecar rather than the model; (c) Grok 4.3 tool-calling reliability on a real leaf; (d) worktree cwd discipline holds.

---

## 7. Risks + what we are deliberately NOT doing

**Risks:**
- Grok coding quality on long-horizon/multi-file leaves is **unproven** — gate pass-rate must validate the cheap/hard split before broad rollout.
- In-process fault isolation: an unhandled throw/OOM in a loop could wobble the daemon — mitigated by per-worker try/catch + deadline.
- `process.chdir` footgun under concurrent in-process workers — mitigated by explicit-cwd discipline.
- Fast-moving Grok model slugs/prices — verify live before wiring; pin model id in profile.
- AI SDK import-path drift (`experimental_createMCPClient` vs `@ai-sdk/mcp`) — verify current v6 path.

**NOT doing:**
- NOT forking opencode (would inherit a product surface we don't want).
- NOT building a generic plugin marketplace / multi-frontend harness.
- NOT moving Claude to an owned harness yet (kept on interactive subscription CLI; metered Agent SDK migration is a separate later decision).
- NOT trusting the model to self-report completion (sidecar+gate owns the verdict).
- NOT abstracting the full `WorkerAgent` port in Phase 0 — prove the loop end-to-end first.

---

## 8. Sources

- Vercel AI SDK: https://ai-sdk.dev/docs/agents/overview · https://ai-sdk.dev/docs/agents/loop-control · https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client · https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools · https://ai-sdk.dev/providers/ai-sdk-providers/xai · https://vercel.com/blog/ai-sdk-6
- opencode: https://opencode.ai/docs/server/ · https://opencode.ai/docs/sdk/ · https://github.com/sst/opencode
- Block Goose: https://github.com/block/goose
- Anthropic ToS / OAuth ban: https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/ · https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/
- Anthropic June-15 metered credit pool: https://thenewstack.io/anthropic-agent-sdk-credits/ · https://www.infoworld.com/article/4171274/anthropic-puts-claude-agents-on-a-meter-across-its-subscriptions/ · https://zed.dev/blog/anthropic-subscription-changes
- Claude Agent SDK (TS): https://code.claude.com/docs/en/agent-sdk/overview · https://github.com/anthropics/claude-agent-sdk-typescript
- xAI/Grok pricing + models: https://x.ai/api · https://docs.x.ai/developers/models · https://mem0.ai/blog/xai-grok-api-pricing
- Grok coding quality: https://codersera.com/blog/grok-build-vs-claude-code-vs-codex-cli-2026/ · https://byteiota.com/grok-build-coding-agent-review-2026/
