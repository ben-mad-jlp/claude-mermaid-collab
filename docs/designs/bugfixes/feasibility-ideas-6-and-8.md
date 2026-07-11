# Feasibility: Ideas 6 and 8

Follow-up to `brainstorm-claude-code-feature-ideas`. Deep dive on the two ideas the user flagged as interesting: #6 (effort knob per artifact) and #8 (computer-use design QA pass). Focus is feasibility + v1 scoping, not implementation.

---

## Idea 6 — Effort knob per artifact

### Capability check
Mixed news. The `effort` parameter ([docs](https://platform.claude.com/docs/en/build-with-claude/effort)) and adaptive thinking ([docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)) are real on Opus 4.6 / Sonnet 4.6, but they are **request-level, not per-tool**. There is no API mechanism where a tool description carries a `thinking.budget` or `effort` hint that the platform consumes. `output_config.effort` is set by the *caller* (Claude Code harness), not by an MCP server. The server cannot reach up into the calling turn's effort setting.

However, adaptive thinking is explicitly **promptable**: "Adaptive thinking's triggering behavior is promptable... you can add guidance to your system prompt" ([adaptive thinking docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking#tuning-thinking-behavior)). So injecting text like *"This artifact is marked HIGH effort — think carefully before mutating"* into a tool description or tool result **is** a legitimate (if indirect) lever. It nudges the model via prompt content, not via a real budget knob. Claude Code does not document any "reasoning hint convention" for tool descriptions — there is no supported hook beyond putting English in the description string.

### Codebase hooks
- `src/services/metadata-manager.ts` — `ItemMetadata` already carries `blueprint`, `locked`, `pinned`, `deprecated`; adding `effort: 'low'|'medium'|'high'|'max'` is a one-field extension.
- `src/mcp/setup.ts:1886` — `set_artifact_metadata` schema; add `effort` to accepted fields.
- `src/mcp/setup.ts:3651` — `set_artifact_metadata` handler; persist via `MetadataManager.updateItem`.
- **Every mutation tool's return path** (`patch_document`, `update_design`, `patch_design_item`, `update_diagram`, `patch_spreadsheet`) — prepend an effort hint to the tool result string when the target artifact has `effort: 'high' | 'max'`. This is where the actual nudge lands: the model reads tool results, so an appended banner like `[effort=max] This artifact is flagged high-effort; reason carefully about downstream impact before the next edit.` is the most reliable vehicle.
- Tool **descriptions** are static strings built once at server startup. They cannot dynamically vary per-artifact at call time, so injecting into the description is **not** the right insertion point — it's the *tool result* that needs the banner.

### V1 scope
- Add `effort?: 'low'|'medium'|'high'|'max'` to `ItemMetadata` + type + `set_artifact_metadata` schema + handler. (~30 LOC.)
- Small helper `appendEffortHint(artifactId, result)` called from ~5 high-value mutation handlers: `patch_document`, `update_design`, `patch_design_item`, `update_diagram`, `patch_spreadsheet`. Looks up the artifact's effort; prepends a one-line banner when `effort` is `high` or `max`.
- UI surface: a pill in the artifact sidebar header (reuse the blueprint/pinned pattern) with click-cycle `low → med → high → max`. Skip UI initially — set it via MCP only and test whether Claude's behavior changes.
- **1–1.5 days** of work.

### Risks
- The nudge is purely a prompt-English signal. On adaptive-thinking models it may shift behavior noticeably; on models without adaptive thinking (Haiku subagents, Sonnet 4.5) it will do essentially nothing.
- You cannot measure "did Claude think harder" from the MCP side. Evaluation is subjective.
- The effort parameter set at the Claude Code harness level will dominate. A `max`-flagged artifact still won't push past a harness-level `low`.
- Risk of banner noise: if every mutation prepends a hint, the model may start ignoring it (hint habituation).

### Recommendation
**Iterate design, then build as a small experiment.** The capability gap (no real per-tool budget) means v1 is a prompt-nudge, not a real effort knob. That's still worth trying — the metadata extension is cheap and reversible. Don't frame it as "effort control"; frame it as **"criticality annotation that biases the model via tool-result banners."** If the banner approach doesn't visibly shift behavior after a week of use, tear it out. The metadata field can stay for UI criticality marking even if the nudge is removed.

---

## Idea 8 — Design QA pass

### Capability check
Strong. Haiku 4.5 is GA via `claude-haiku-4-5` with first-class computer-use support, specifically positioned for sub-agent orchestration at $1/$5 per M tokens ([Anthropic Haiku 4.5 announcement](https://www.anthropic.com/news/claude-haiku-4-5), [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)). Claude Code subagents can be pinned to a specific model via YAML frontmatter ([subagents docs](https://code.claude.com/docs/en/sub-agents)). Chrome DevTools MCP is available and includes `take_screenshot`, `take_snapshot`, `navigate_page`, `resize_page`, `evaluate_script`, `list_console_messages` — everything needed for visual diffing ([chrome-devtools-mcp on GitHub](https://github.com/ChromeDevTools/chrome-devtools-mcp/)). Precedent: CyberAgent drove 236 Storybook stories through a Chrome-DevTools-MCP agent loop for a visual audit.

One caveat: "computer use" as the **beta API feature** (click/type/screenshot on a virtual desktop) is different from what a Claude Code subagent actually does — the latter uses MCP tools like `chrome-devtools__take_screenshot` which is simpler and more reliable. You don't need the full computer-use beta. **A Haiku 4.5 subagent with the chrome-devtools MCP tools is sufficient and cheaper.**

### Codebase hooks
- `src/mcp/setup.ts`:
  - `create_storybook_embed` (line 1869) and `list_storybook_stories` (line 1870) — already wire Storybook stories into designs.
  - `annotate_node` (lines 1343, 2726) + `get_annotations` + `remove_annotation` — annotation surface for writing findings back.
  - `add_design_image` (lines 1302, 2675) + `set_node_image` (1307, 2682) — attach screenshots as design nodes.
  - `export_design_png` / `export_design_svg` (lines 1337, 1312) — produces the "intent" image for the subagent to compare against.
  - `describe_design` (line 1359) — text description of the wireframe tree to feed Haiku as structured intent.
- `skills/wireframing/SKILL.md` — existing skill to extend, or create sibling `skills/design-qa/SKILL.md`.
- **No new backend endpoints needed.** This is pure tool orchestration by a Claude Code subagent.

### V1 scope
- One new skill file `skills/design-qa/SKILL.md` that documents the loop. **No MCP tool needed at all initially.**
- Happy path: user runs the skill pointing at a wireframe design ID that has a linked storybook embed. The skill spawns a Haiku 4.5 subagent with `chrome-devtools` + `mermaid` tool access and a prompt template:
  1. `get_design` + `describe_design` for intent.
  2. `get_document` on the linked storybook embed artifact to find the iframe URL.
  3. `chrome-devtools__navigate_page` → `resize_page` → `take_screenshot`.
  4. `export_design_png` of the wireframe for side-by-side comparison (Haiku reads both images).
  5. For each mismatch found: `annotate_node` with `status: 'needs-review'` and `notes: <finding>`, optionally `add_design_image` to attach the storybook screenshot.
- Scope cut: single design, single story, single viewport (desktop 1280px), no loop/auto-iteration. Just one pass producing annotations.
- **2–3 days** including prompt tuning.

### Risks
- Haiku 4.5's visual judgment on "does this component match wireframe intent" is unknown quality. Wireframes are intentionally loose — diffing a gray-box wireframe against a styled storybook component will produce a lot of false positives ("colors don't match!"). **The prompt needs to explicitly instruct the subagent to compare structure and layout, not pixels.**
- Subagent context cost: passing two images + full design description + full storybook DOM snapshot per iteration. Haiku pricing softens this, but expect $0.05–$0.20 per QA pass. Fine for manual invocation, not for an auto-hook.
- Chrome DevTools MCP requires a running Chrome instance and a running Storybook dev server. The skill has to document this as a prerequisite.
- Annotation targeting: the subagent needs to know which design node to annotate. `describe_design` returns node IDs with their text/labels, so "button labeled 'Submit'" can be resolved — but noisy wireframes may not have clean labels. **Accept: v1 attaches findings at the root node, not leaf-precise.**

### Recommendation
**Build.** All capabilities exist today, no upstream dependency, everything is wired into the project already. V1 is a skill file plus prompt engineering — no code changes to `src/`. Start here.

---

## Cross-cutting

### Shared infrastructure
Minimal overlap. Idea 6 touches `metadata-manager.ts` + `set_artifact_metadata`; Idea 8 touches annotation tools + chrome-devtools subagent orchestration. Only intersection: a QA-pass result artifact (annotations bundle) could itself carry an `effort: high` tag so subsequent edits get the nudge banner — opportunistic, not structural.

### Suggested build order
1. **Idea 8 first** (2–3 days). Real capability, delivers visible value, needs no backend changes. Ship it as a skill.
2. **Idea 6 as a small experiment** (1–1.5 days) after Idea 8 lands. Keep scoped to metadata + tool-result banner on 5 mutation handlers. Evaluate for a week. If no visible behavior shift, pull the nudge but keep the metadata field for UI criticality marking.

**Total: ~4 days of focused work for both, with Idea 8 carrying most of the payoff.**

---

## Sources
- [Building with extended thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Adaptive thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Effort parameter — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Introducing Claude Haiku 4.5 — Anthropic](https://www.anthropic.com/news/claude-haiku-4-5)
- [Claude Code Sub-agents docs](https://code.claude.com/docs/en/sub-agents)
- [chrome-devtools-mcp on GitHub](https://github.com/ChromeDevTools/chrome-devtools-mcp/)
- [Give your AI eyes: Chrome DevTools MCP — Addy Osmani](https://addyosmani.com/blog/devtools-mcp/)
