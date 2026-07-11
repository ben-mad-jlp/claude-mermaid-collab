# Vibe: grok-worker

## Goal
Research whether to reconsider the "no CLI for grok worker" decision — specifically:
fork **opencode** (open-source agent CLI), edit it (it's OSS), and inject collab
directly into it. Resolved: **keep our own harness** (in-process Vercel AI SDK loop,
grok-build pinned today, provider-agnostic by design). Session has since grown into
ongoing collab-app maintenance + daemon/UI work.

## Context
- Current worker = in-process AI SDK loop with tools get_todo/complete_todo/
  write_file/read_file/run_bash; MCP funnel called in-process.
- Already provider-agnostic in name (PAW) but pinned to grok-build today.
- opencode (sst/opencode) is an OSS terminal AI agent, provider-agnostic, TS.

## Checkpoint
_Updated 2026-06-18 — resume reads this section._

- **CHECKPOINT MECHANISM FIX (this session's work):** checkpoints no longer abuse the
  todo system. Old flow minted a `planned` marker todo to carry checkpoint text (a hack
  forced by the claimability model removing interactive `in_progress` todos). New flow:
  checkpoint lives in THIS `## Checkpoint` section of vibe.vibeinstructions.
- **Shipped (uncommitted working tree):** rewrote `skills/vibe-checkpoint/SKILL.md`
  (writes ## Checkpoint section, calls checkpoint_ready with checkpointDocId); updated
  `skills/vibe-active/SKILL.md` resume to read ## Checkpoint (not in_progress todo);
  added ## Checkpoint placeholder to the new-vibe templates in vibe-active + collab
  SKILLs; flipped `checkpoint_ready` tool description in `src/mcp/setup.ts:2179` to
  doc-preferred / todo-legacy (backend doc path at setup.ts:4860 already worked).
- **Migrated this session** off marker todo `#2221` (dropped) into this section — dogfooding the new flow.
- **NEXT:** verify (`bun run build`/tsc) the setup.ts edit; then commit. Consider whether
  to deploy so the live MCP description updates. Skills propagate via plugin republish.
- **Prior shipped work (committed to master, NOT pushed):** large UI/daemon maintenance
  batch — latest commits 0f7e7a87 + 0c35685a. See dropped todo `#2221` history if needed.
- **Still open / awaiting GO:** HELD epic `#ca59` "Levels → off/on/auto + swappable
  triage" (doc `design-levels-offonauto-and-swappable-triage`), L1–L6 + LAND, all planned.

## Pair Mode
Disabled

## Agent Mode
Enabled
