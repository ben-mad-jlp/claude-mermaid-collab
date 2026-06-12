# Owned Agent Harness — Phase-0 spikes

De-risks the "kill the tmux pane-scrape" thesis (design docs `spike-owned-agent-harness`
+ `design-provider-agnostic-workers`, session `supervisor-firstclass`). Drives **Grok
headless via the Vercel AI SDK** as a coding worker — no tmux, no pane-scraping, no `claude`.
Completion is **sidecar-authoritative**: the harness's `done` triggers the gate, which decides accept.

## `grok-worker.ts` — spike 0/1 (the loop)
Fresh isolated scratch git repo + sandboxed structured tools (write/read/list/bash) →
`generateText({ model: xai('grok-build-0.1'), stopWhen: stepCountIs(40) })` → gate
(test green + commit landed). Proves the loop works headless.

```
XAI_API_KEY=... bun run spike/grok-worker.ts
```

## `grok-worker-v2.ts` — spike 2 (the real machinery)
Drives the **real** seams: real `WorktreeManager.ensure()` isolation, Grok calls our
**real MCP tools** (`get_todo`/`complete_todo`) via `@modelcontextprotocol/sdk` spawning
`src/mcp/server.ts`, against a **real work-graph todo on the live sidecar (:9002)**, then
verifies the real store flipped to `done+accepted`.

```
# create a throwaway git repo on `main` + a ready work-graph todo first, then:
XAI_API_KEY=... bun run spike/grok-worker-v2.ts <project> <todoId>
```

Last run (2026-06-12): ✅ ACCEPTED — Grok closed a real gated leaf via our MCP tools in a
real worktree, headless. 11 steps · ~20s. Every scrape seam from the doc de-risked.

> Throwaway research code — `@modelcontextprotocol/sdk` resolves from the repo root; the
> AI SDK (`ai`, `@ai-sdk/xai`, `zod`) is pinned in `spike/package.json`.
