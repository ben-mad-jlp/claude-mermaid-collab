# Feasibility: Grok Ideas 2 and 8

Claude's independent research pass on two ideas from `grok-brainstorm-features`:
- #2 Background Muse Incubators (🔴 moonshot)
- #8 Context Gardener (🟢 incremental)

**Headline finding:** both Grok framings reference primitives that Claude Code does not expose to MCP servers or does not implement at all. The buildable cores underneath are much more mundane than the pitches suggest.

---

## Critical capability facts (both ideas depend on these)

1. **MCP sampling is NOT supported by Claude Code.** [Issue #1785](https://github.com/anthropics/claude-code/issues/1785) still open as of April 2026. MCP server cannot borrow the user's subscription for Haiku cycles. Either pay directly with a server-held `ANTHROPIC_API_KEY`, or drop the model-in-the-loop entirely.
2. **Background tasks an MCP server can schedule don't exist.** Claude Code's "background" = Ctrl+B subagents that live inside one user session. Managed Agents / Tasks are first-party, user-invoked, cloud-hosted — not something the MCP server can spawn. See [background task request #9905](https://github.com/anthropics/claude-code/issues/9905).
3. **The `/memories` tool is client-side.** It's an Anthropic API feature (`type: "memory_20250818"`) where the client implements storage. Claude Code has its own `CLAUDE.md` auto-memory convention. **An MCP server cannot read or write the same memory the model uses** — it can only maintain a parallel filesystem exposed via its own tools.
4. **Checkpointing is owned entirely by the Claude Code client.** No hook, no MCP method for the server to inspect or prune the 1M context window. See [checkpointing docs](https://code.claude.com/docs/en/checkpointing).
5. **Project storage** is filesystem under `.collab/sessions/<name>/` (documents, diagrams, designs, snippets, `metadata.json`, `collab-state.json`, `update-log.json`). Lessons are a per-session `documents/LESSONS.md`. No SQLite for session content. No in-server job scheduler. No Anthropic SDK currently imported.

---

## Idea 2 — Background Muse Incubators

### Capability check
Fails on multiple fronts:
- **Background Tasks the MCP server can spawn:** don't exist. `src/server.ts` is long-running, so a `setInterval` job queue is the only real option.
- **Sleeping on `/memories`:** mechanically impossible as stated. Server would maintain its own parallel `.collab/muse/` directory that the model only sees via MCP tools.
- **Sampling for cheap Haiku cycles:** blocked by #1785. Either burn real API dollars with a server-side key, or use a deterministic heuristic.
- **Surfacing "ahas" into an active session:** MCP servers cannot push notifications into Claude's context mid-turn. The only paths are: a tool the model calls, or a UI surface the user opens.

### Codebase hooks
- `src/mcp/tools/lessons.ts` — append-only markdown; needs a read-all-sessions variant for cross-session muse context
- `src/services/session-registry.ts` — enumerate sessions per project
- `src/mcp/setup.ts` — where new MCP tools (`list_muse_cards`, `dismiss_muse_card`) register
- `scripts/notification-hook.sh` (Stop) and `scripts/active-hook.sh` (PreToolUse/PostToolUse/UserPromptSubmit) — already POST to `http://localhost:3737/api/session-notify`; the muse worker would live in that server process
- `src/server.ts` / `src/routes/api.ts` — natural home for the `setInterval` worker
- `ui/src/components/layout/SubscriptionsPanel.tsx` / `Sidebar.tsx` — card pattern exists but no "feed" surface yet
- `.claude-plugin/plugin.json` — no new hook registration needed; existing Stop hook can trigger muse generation server-side

### V1 scope — rename and cut: **Cross-Session Insight Digest**
1. On Stop hook (or 15-minute timer in `server.ts`), backend reads `LESSONS.md` from all sessions in the current project.
2. If new lessons since last run, make **one direct Anthropic API call** (Haiku, server's own API key, opt-in via env var): "Here are lessons from N parallel sessions. Find one non-obvious connection." Budget ~100 tokens out.
3. Write result to `.collab/muse/cards.json` with `{id, createdAt, sourceSessions, text, dismissed}`.
4. New MCP tools: `list_muse_cards(project)`, `dismiss_muse_card(id)`. New UI panel in sidebar.
5. No "unconscious sleeping," no sampling, no separate long-running agent.

### Risks / blockers
- **No sampling** = either burns API dollars or depends on a cron the user didn't ask for. Hard daily token budget required.
- **No MCP access to Claude Code memory** = Grok's framing is mechanically impossible. Building on `.collab/` filesystem state only.
- **Signal quality:** Haiku summarizing unstructured markdown lessons will mostly produce plausible noise. No tags, no embeddings, no graph. Cards will be ignored within a week.
- **No push surface:** can't notify mid-turn. Relies on the user opening the UI.

### Recommendation: **Redesign, then build the stripped version**
Drop "muse / unconscious / sleeping agent" framing entirely. Build Cross-Session Insight Digest as a scheduled backend job behind a feature flag with a hard daily token budget. If cards get engaged with, add structure (tags, embeddings). If not, kill it.

---

## Idea 8 — Context Gardener

### Capability check
**The stated pitch is a category error.** The 1M context belongs to the Claude Code client. An MCP server has zero API surface to read, prune, or rewrite it. The only things that touch the context window directly are [checkpointing](https://code.claude.com/docs/en/checkpointing) (`/rewind`, `Esc Esc`, "Summarize from here") and compaction (`/compact`) — all user-invoked from inside the client.

The legal moves an MCP server has:
1. **Return smaller payloads from existing tools** (e.g. `list_lessons` summary mode). Real, valuable.
2. **Expose archive/restore tools** the model calls voluntarily. Real, useful.
3. **Tell the user to run `/compact`** via a UI nudge. Just documentation.

None of these is "continuous pruning." Grok's framing assumes a supervisor that doesn't exist.

### Codebase hooks
- `src/mcp/tools/lessons.ts` — biggest win: add `list_lessons(mode: "summary" | "full", since, tags)` and store per-lesson `importance` in a sidecar JSON
- `src/mcp/tools/collab-state.ts` — existing session-state tool
- `src/services/metadata-manager.ts` — **already tracks `deprecated` and `locked`**; an "archive" flag is a tiny extension. `deprecate_artifact` tool already exists and is the closest existing primitive.
- `src/services/session-registry.ts` — enumerate items to score
- `src/mcp/tools/projects.ts` — new tool registration
- No UI surface needed for v1; v2 could add an "Archived" accordion in `Sidebar.tsx`

### V1 scope — strip to **Lesson & Artifact Scoring + Lazy Retrieval**
1. Extend `metadata.json` with `{score, lastAccessedAt, archivedAt}` per item. Score = deterministic: age decay + access recency + lock flag + word-count threshold.
2. Add `list_lessons(mode, limit)` — `summary` returns first line + tags + id; `full` returns bodies. Default: summary.
3. Add `get_lesson(id)` for on-demand full-body pulls.
4. Add `archive_artifact(id)` / `restore_artifact(id)` that flip a flag in `metadata.json`; existing list tools filter archived by default.
5. Update `vibe-active` / `vibe-go` skill prompts: "call `list_lessons` in summary mode first, pull full only when relevant."

**Zero background workers, zero Haiku, zero sampling. Ships in a day.**

### Risks / blockers
- **The stated feature ("prune 1M context") cannot be built.** Context is not the server's to prune.
- **"Symbolic links the agent can pull"** collapses to "MCP tools with pagination." Good API design, not a system.
- **Auto-scoring with Haiku** requires a paid API loop with no sampling offset. Probably not worth it vs. a deterministic heuristic.
- **Over-archiving risk.** Never delete, only hide from default listings.

### Recommendation: **Cut to the buildable core and ship.**
Ship the stripped version. Do **not** market it as "context gardener" or "continuous pruning" — those promise something the platform doesn't allow and users will notice.

---

## Cross-cutting

### Shared infrastructure
Both stripped-down versions want the same three things:
1. **Per-project metadata sidecar** with scores/tags/archive flags — extend existing `metadata.json` via `metadata-manager.ts`, no new DB
2. **Summary-mode variants** of existing list tools (`list_lessons`, `list_documents`, `list_designs`)
3. **Deterministic heuristic** for "stale" — age, access recency, explicit locks. No Haiku needed for v1.

Muse v1 *also* wants a backend `setInterval` worker and a feed surface in the UI sidebar. Gardener v1 needs neither.

### Which is more buildable today?
**Idea 8, hands down.** ~200 lines of metadata plumbing plus two new list modes. No new runtime, UI, API keys, or uncertain background primitive. **Ship this week.**

**Idea 2** depends on either the user granting an API key (burns money) or waiting for MCP sampling to land in Claude Code (no ETA). Stripped version is still a 1–2 week feature with ongoing token costs and uncertain signal quality.

### Honest take: is Grok's framing load-bearing?
**No.** Both ideas are dressed up to sound like cognitive-architecture research when the buildable cores are mundane infrastructure. Grok gestures at primitives (Background Tasks, `/memories`, MCP sampling, 1M pruning) that Claude Code either does not expose to MCP servers or does not implement at all. Specifically:
- Background Tasks an MCP server can schedule: **does not exist**
- Shared `/memories` between model and server: **does not exist**
- MCP sampling in Claude Code: **does not exist**
- Server-side context pruning: **architecturally impossible**

What *does* exist and is worth leaning on: filesystem-backed session state, a long-running `server.ts` with hooks already POSTing to it, a React sidebar with a card pattern, and the `metadata-manager` deprecation flag. Build on those.

### My vote
- **Drop Idea 2 for now** (or park until MCP sampling lands in Claude Code — then it becomes a 3-day project)
- **Build Idea 8's buildable core** (summary mode + metadata scoring + archive flag) this week
- **Do not call it a "gardener."** Call it what it is: better list pagination with a stale-item filter.

Beautiful names for things the platform can't actually do will burn trust faster than shipping nothing.

---

## Sources
- [Memory tool — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Checkpointing — Claude Code Docs](https://code.claude.com/docs/en/checkpointing)
- [MCP Sampling Feature Request #1785](https://github.com/anthropics/claude-code/issues/1785)
- [Background Agent Execution Feature Request #9905](https://github.com/anthropics/claude-code/issues/9905)
- [Claude Code Async: Background Agents & Parallel Tasks](https://claudefa.st/blog/guide/agents/async-workflows)
- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
