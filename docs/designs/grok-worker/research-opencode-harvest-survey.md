# opencode harvest survey — per-battery build-vs-harvest plan

Maps the daemon-worker batteries (see `design-daemon-worker-batteries`) to opencode source +
extraction feasibility. License: **MIT confirmed** (`Copyright (c) 2025 opencode`), NO per-file
headers → preserve repo LICENSE + an attribution comment per vendored file.

## ⚠️ Critical: harvest from the PRE-EFFECT version, not latest
opencode has TWO coexisting agent cores — picking the wrong one poisons every verdict:
- **`dev` / current releases (v1.17.x, org `anomalyco`)** — mid-migration to **Effect** (`Effect.fn`,
  `Layer`, `Schema`, `InstanceState`, `@opencode-ai/core`). Every tool drags in the Effect runtime.
  **Lifting from here = adopting Effect.** Bad source for our plain-async Bun+AI-SDK worker.
- **Tag `v0.3.0` (pre-Effect)** — plain `async/await`, Zod + Standard Schema, `ai` SDK directly,
  `Bus.publish` events, `App.state()` context. **SAME STACK AS US → this is the harvest target.**
  PIN this tag before vendoring; paths are stable there.

Layout: `packages/opencode/src/...` = agent core (harvest here). `packages/tui/` = Go TUI, separate
process, ZERO core imports → the agent core is cleanly separable; lift tools/loop without any UI.

## Battery-by-battery (verdicts assume v0.3.0 plain-async)
| # | Battery | Path | Feasibility | Recommendation |
|---|---|---|---|---|
| 1 | **Edit / diff-apply** | `tool/edit.ts` (replacer cascade: Simple/LineTrimmed/BlockAnchor+Levenshtein/Whitespace/Indentation/Escape/ContextAware/MultiOccurrence + `isDisproportionateMatch`) | **CLEAN-LIFT** (v0.3.0; pure string→string, deps only `diff`+`zod`+`path`) | **HARVEST FIRST.** Extract as standalone `applyEdit(content, old, new, replaceAll)`. The edge-case logic is exactly what you don't want to rewrite. |
| 2 | **Grep/Glob/Read** | `tool/grep.ts`, `glob.ts`, `read.ts` + ripgrep wrapper | **CLEAN-LIFT** | Lift ripgrep wrapper + read offset/line-number formatter (1-indexed, `lineNo: content`, 50KB cap, next-offset hint). Glob = ripgrep `--files`. |
| 3 | **MCP client** | `mcp/index.ts` | **CLEAN-LIFT (v0.3.0)** | v0.3.0 is just AI SDK `experimental_createMCPClient` + `ai/mcp-stdio` + SSE, `clientName_toolName` flattening — near-zero custom code. For remote-HTTP+OAuth, read `dev`'s mcp as REFERENCE only. |
| 4 | **Tool dispatch / interception** | `session/prompt.ts`, `session/tools.ts`, `tool/tool.ts`, `plugin/` | **READ-ONLY REFERENCE** | Their veto/hook = `tool.execute.before/after` via plugin `trigger()` + permission `ask()`. Coupled to plugin/Bus. Adopt the two-hook SHAPE (before mutates/denies args, after mutates result) into OUR loop; don't lift the plugin machinery. |
| 5 | **Provider/model resolution** | `provider/provider.ts` + models.dev | **REFERENCE + reuse models.dev** | Pattern: models.dev catalog → dynamic-import `@ai-sdk/*` by provider id → per-provider loader → cache. Consume models.dev directly (public JSON); reimplement `resolveModel(provider, modelId)` (~100 lines) — too entangled to lift verbatim. |
| 6 | **Bash + sandbox** | `tool/bash.ts` (v0.3.0) / `shell.ts` (dev) | **CLEAN-LIFT exec; NO sandbox exists** | Lift v0.3.0 `Bun.spawn(["bash","-c"])` + timeout (1min/10min). opencode has NO network sandbox — build our own. REFERENCE dev's `shell.ts` command-parse→per-path/per-command permission gating for our veto layer. |
| 7 | **Prompt caching** | `session/prompt.ts`, `system.ts` | **BUILD OUR OWN** | They TRACK cache tokens but no reusable `cacheControl` key-construction. Add Anthropic `cache_control` breakpoints (system + stable tool defs + last turn) ourselves. |
| 8 | **Retry / rate-limit** | `session/retry.ts` | **CLEAN-LIFT logic** | Exp backoff (2s→×2→30s cap), honors `retry-after-ms`/`retry-after`, retries 5xx, EXCLUDES context-overflow, detects rate-limit patterns + provider codes. Port the pure `delay()` + `retryable()` predicates off Effect Schedule. High value, edge-case-heavy. |
| 9 | **Core agent loop** | `session/prompt.ts` `runLoop` + `processor.ts` | **READ-ONLY REFERENCE** | We have our own (GrokOwnHarness). Steal their compaction/overflow handling + max-step-per-agent structure. |

## Harvest FIRST (prioritized)
1. **`tool/edit.ts` replacer cascade** (v0.3.0) — highest-value, hardest-to-rewrite. Extract pure `applyEdit()`.
2. **`session/retry.ts` `delay()`+`retryable()`** — port the two predicates.
3. **ripgrep wrapper + `read.ts` formatter** — small, clean, immediately useful.
4. **`mcp/index.ts` (v0.3.0)** — the AI-SDK MCP stdio+sse glue.
5. **Reference + reimplement:** `provider.ts` resolver + consume models.dev; `dev/shell.ts` command→permission gating for the veto layer.

## ⚠️ Edit-tool correctness caveat (upstream-acknowledged)
GitHub issues **#1261** (ambiguous edits can corrupt files) + **#2433** (disable BlockAnchorReplacer).
The `replaceAll:false` uniqueness check only fully guards `SimpleReplacer`. When we lift the cascade,
**harden the uniqueness gate across ALL replacers**, not just SimpleReplacer. Don't lift the bug.

## Uncertainties
- Couldn't confirm the exact lowest tag, but `v0.3.0` fetched cleanly + is unambiguously the
  plain-async/Zod era → valid target. Pin a specific tag before vendoring (latest moved code into
  `packages/core/src/` under Effect).
