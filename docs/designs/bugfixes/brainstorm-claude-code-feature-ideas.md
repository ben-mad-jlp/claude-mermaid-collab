# Brainstorm: Out-of-the-box feature ideas for claude-mermaid-collab

Generated 2026-04-10. Focus: leverage recent Anthropic/Claude Code releases (Opus 4.6, Haiku 4.5 computer use, new hooks, MCP elicitation/sampling/roots, memory tool, checkpointing, background Tasks, 1M context) to make the collab workspace squeeze more out of Claude Code.

Wildness legend: 🟢 incremental · 🟡 ambitious · 🔴 moonshot

---

## 1. Async subagent → live artifact "review cards" 🟡
**Pitch.** When a backgrounded subagent finishes (e.g. a `vibe-go` wave worker), auto-post a "review card" into the parent session's UI feed with a design-diff, pseudocode-diff, and the list of touched files as a clickable card.

**Leverages.** The new `SubagentStop` hook fields (`agent_id`, `agent_transcript_path`) + async background subagents that wake the parent when done.

**Why it fits.** `vibe-go` already dispatches parallel agents in waves; right now the parent has to read transcripts manually. A card feed turns async completions into a reviewable stream.

**Sketch.** `SubagentStop` hook → script reads transcript → calls `describe_design_changes` + `pseudo_impact_analysis` → new `post_review_card` MCP tool renders a card in the SubscriptionsPanel with Approve/Reject/Comment buttons wired to `get_ui_response`.

---

## 2. Elicitation-backed `ui-question` with structured forms 🟢
**Pitch.** Replace the current browser UI question flow with MCP elicitation so *any* MCP client (not just the collab UI) can ask structured questions mid-tool-call, and the collab UI renders them as real forms.

**Leverages.** MCP elicitation primitive (server pauses tool execution, requests structured JSON from user).

**Why it fits.** The project already has `ui-question` / `render_ui` / `get_ui_response`. Porting to elicitation makes it a first-class MCP citizen and lets `wireframing` / `writing-plans` skills ask mid-execution questions without custom polling.

**Sketch.** Wrap existing `render_ui` as an elicitation handler; expose JSON-schema forms. Fallback to browser UI when client doesn't support elicitation.

---

## 3. Sampling-powered "self-critiquing" design lint 🟡
**Pitch.** `lint_design` uses MCP sampling to ask the *client's* LLM (not a hard-coded rule set) to critique wireframe nodes against the attached design tokens and prior lessons — free intelligence, no API key in the server.

**Leverages.** MCP sampling primitive (server requests completions from client-side model).

**Why it fits.** Currently `lint_design` is rule-based. Sampling turns every design mutation into an opportunity for the calling model to grade its own work against `list_lessons` context.

**Sketch.** `lint_design` server-side: fetch design + relevant lessons → sampling request with a critique prompt → return structured issues to the tool caller. Zero server-side model cost.

---

## 4. `/rewind` → artifact-aware snapshots 🟡
**Pitch.** Wire Claude Code's checkpoint/rewind into the collab server so rewinding the conversation also rewinds diagram/design/document state to the matching snapshot.

**Leverages.** Claude Code checkpointing (`/rewind`, Esc+Esc) which currently only tracks Claude's direct file edits.

**Why it fits.** Every artifact already has history (`get_design_history`, `get_diagram_history`). Users currently get confused when they `/rewind` code but artifacts stay at a later state.

**Sketch.** `PreCompact` / `SessionStart` hook stamps artifact versions into a manifest keyed by Claude Code's checkpoint id. A new `rewind_artifacts_to_checkpoint` tool replays `revert_*` calls to match. Surface as a "Rewind artifacts too?" prompt in the UI when a checkpoint restore is detected.

---

## 5. Memory-tool-backed lessons and vibe instructions 🟢
**Pitch.** Expose `.vibeinstructions`, lessons, and pseudo-prose via Anthropic's new file-based memory tool interface so sub-agents auto-load them without explicit skill prompts.

**Leverages.** Claude Agent SDK memory tool (`/memories` directory persisted between sessions) + skills frontmatter that auto-loads skills for subagents.

**Why it fits.** `vibe-checkpoint` currently stuffs state into a snippet read by `vibe-read`. The memory tool formalizes this as automatic cross-session recall.

**Sketch.** Collab server mounts `/memories/collab/<project>/` and writes lessons/vibeinstructions there on every update. Skills frontmatter marks them auto-load. `PreCompact` hook writes a final state blob.

---

## 6. Adaptive-thinking "effort knob" per session artifact 🟢
**Pitch.** Each artifact (design, spreadsheet, task graph) gets a "cognitive effort" dial (low/medium/high/max). MCP tools that mutate it inject corresponding adaptive-thinking hints into their tool descriptions so the calling model knows when to burn tokens.

**Leverages.** Opus/Sonnet 4.6 adaptive thinking with effort controls.

**Why it fits.** Right now the model has no signal that "this is the critical auth flow diagram" vs "this is a scratch sketch." Artifact-level effort hints bubble up through existing `set_artifact_metadata`.

**Sketch.** Add `effort` to artifact metadata. Tool descriptions dynamically include "this artifact is marked high-effort; use extended thinking before editing" — visible in the tool result header.

---

## 7. Long-running "design watcher" background Task 🔴
**Pitch.** A persistent background Task that watches a design artifact and, whenever dependent code files drift from the design (detected via `pseudo_stale_check`), wakes the main agent with a repair prompt.

**Leverages.** Claude Code Tasks (long-running agents across sessions, wake-parent-on-completion) + the new `/tasks` command.

**Why it fits.** `pseudo_stale_check` already exists but is pull-only. Making it a background Task turns the collab server into a living conscience.

**Sketch.** New `start_design_watcher(design_id)` MCP tool spawns a TaskCreate with a Haiku 4.5 loop that polls stale checks every N minutes and calls RemoteTrigger on drift. Badge appears in SubscriptionsPanel.

---

## 8. Computer-use "design QA pass" 🟡
**Pitch.** A skill that takes a wireframe + its linked storybook embed and runs a computer-use agent to visually diff the rendered component against the wireframe intent, producing annotated screenshots back into the design.

**Leverages.** Haiku 4.5 computer use (now cheap enough for loops) + existing Chrome DevTools MCP.

**Why it fits.** The project already has storybook embeds and `annotate_node`. This closes the design-intent → implementation-reality loop.

**Sketch.** `design_qa_pass(design_id)` → chrome-devtools MCP navigates to the storybook URL → takes snapshot → Haiku compares each node's intent → `annotate_node` writes findings → `add_design_image` attaches the screenshot.

---

## 9. Cross-session "standup digest" via SessionEnd hook 🟢
**Pitch.** When any Claude Code session ends, auto-generate a digest document in the collab workspace summarizing artifacts touched, lessons learned, and open task-graph items, grouped per day. Morning standup writes itself.

**Leverages.** `SessionEnd` hook (new), `generate_session_summary` (existing).

**Why it fits.** Multi-session is already the point of this project; an aggregated digest across sessions is the missing capstone.

**Sketch.** `SessionEnd` hook → calls `generate_session_summary` → appends to a `daily-digest` document → `deprecate_artifact` rolls yesterday's. A `CronCreate`-driven morning agent can then consume it.

---

## 10. Sampling-based "blueprint negotiator" between two sessions 🔴
**Pitch.** Two registered sessions (e.g. "backend" and "frontend") negotiate a shared API contract by ping-ponging sampling requests through the collab server: backend session proposes a schema, frontend session's LLM critiques it via sampling, iterate until both signal accept.

**Leverages.** MCP sampling + existing multi-session registry (`register_claude_session`, `list_sessions`).

**Why it fits.** Multi-session is already core; most users have backend/frontend split. Turning the collab server into a negotiation broker is a differentiator nobody else has.

**Sketch.** `propose_contract(from_session, to_session, payload)` stores proposal, fires a notification to the other session's UI, target session accepts via a tool that sampling-critiques and either signs off or counter-proposes. All versions logged as document history.

---

## 11. 1M-context "whole-repo design briefing" tool 🟡
**Pitch.** `brief_from_repo(path)` crams the entire repo + every pseudocode entry + all lessons into a single Opus 4.6 call and returns a design-ready briefing doc and a starter task graph.

**Leverages.** Opus 4.6's 1M context window with no long-context surcharge.

**Why it fits.** `pseudo_index_project` already exists as a compression layer; most projects fit in 1M when pseudocode-indexed. Currently nothing exploits this for a one-shot cold-start.

**Sketch.** Server concatenates files + pseudo prose + `list_lessons` → single Opus call via sampling → result becomes a document + `sync_task_graph` seed. Show a "Brief cost: $X" estimate before firing.

---

## 12. `SubagentStart` → auto-provision a scoped MCP root 🔴
**Pitch.** Every subagent gets its own MCP root (scoped directory) auto-created by the collab server with only the artifacts it needs pre-linked, so parallel agents can't step on each other's files.

**Leverages.** MCP roots primitive + `SubagentStart` hook + existing `dispatching-parallel-agents` skill.

**Why it fits.** Parallel-agent clobbering is a known pain in `vibe-go`. Roots give a clean filesystem boundary per agent that the rest of MCP understands.

**Sketch.** `SubagentStart` hook reads agent_id → calls `provision_scoped_root(agent_id, artifact_ids)` → server creates a tmp worktree + symlinks only the needed artifacts → emits a roots notification. `SubagentStop` tears down and merges.

---

## Suggested pilot order

1. **#1 review cards** — biggest leverage on existing `vibe-go` wave dispatch
2. **#4 rewind-aware artifacts** — fixes an active footgun (checkpoint ↔ artifact drift)
3. **#2 elicitation** — cheap win that upgrades `ui-question` to a real MCP primitive
4. **#9 standup digest** — low effort, high daily-value multiplier

## Sources
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Enabling Claude Code to work more autonomously](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously)
- [Introducing Claude Opus 4.6](https://www.anthropic.com/news/claude-opus-4-6)
- [Claude Code Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Claude Agent SDK Memory Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Use Claude Code with Chrome](https://code.claude.com/docs/en/chrome)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills)
