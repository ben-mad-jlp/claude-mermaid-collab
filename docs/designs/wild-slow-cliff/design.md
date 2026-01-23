# Design Document

## Session Context

Project: claude-mermaid-collab
Created: 2026-01-23

## Work Items

### Item 1: Hide zoom controls on document screens
**Type:** code
**Status:** documented
**Problem/Goal:** Zoom controls appear on document screens but aren't useful there

**Approach:** Add `showZoom` prop to EditorToolbar (default true), set false when itemType === 'document'

**Success Criteria:** Zoom controls hidden on document views, visible on diagram views

**Decisions:** Simple prop-based conditional rendering

---

### Item 2: Show context percentage at compaction prompts
**Type:** code
**Status:** documented
**Problem/Goal:** Users need context usage info to decide whether to compact

**Approach:** Update compaction checkpoint prompts in skills to instruct Claude to check/report context percentage when asking about compaction

**Success Criteria:** Compaction prompts include context usage percentage

**Decisions:** Claude observes its own context state and includes % in prompt

---

### Item 3: Fix subagent-driven-development not available as Task agent
**Type:** bugfix
**Status:** documented
**Problem/Goal:** subagent-driven-development not available when using Task tool

**Approach:** Move from skills/ to agents/ folder and rename SKILL.md to AGENT.md

**Root Cause:** Skills (skills/ + SKILL.md) are user-invocable only. Agents (agents/ + AGENT.md) are available as Task agents.

**Success Criteria:** `mermaid-collab:subagent-driven-development:subagent-driven-development` appears in available Task agents

**Decisions:** Follow same pattern as verify-phase, systematic-debugging, etc.

---

### Item 4: Auto-resume after collab-compact
**Type:** code
**Status:** documented
**Problem/Goal:** After compaction, user has to manually run /collab to resume

**Approach:** Change collab-compact Step 5 to invoke collab skill directly instead of telling user to run it

**Success Criteria:** Session auto-resumes after compaction without user intervention

**Decisions:** Invoke collab skill at end of collab-compact

---
