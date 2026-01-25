# Session: warm-brave-spring

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Create Kodex skill
**Type:** code
**Status:** documented
**Problem/Goal:**
Claude needs guidance on when and how to use the project knowledge base (Kodex) to leverage existing project knowledge and maintain its accuracy.

**Approach:**
1. **Proactive Query** - When starting work that might benefit from project knowledge, query relevant topics by inferring topic names from task context. Use `kodex_query_topic` directly.
2. **Flagging Outdated Topics** - When a queried topic contradicts actual code (verified), flag it using `kodex_flag_topic` with type "outdated" or "incorrect".
3. **Skill structure** - Single `skills/using-kodex/SKILL.md` file with when/how guidance.

**Success Criteria:**
1. Skill file exists at `skills/using-kodex/SKILL.md`
2. Skill describes when to query Kodex (judgment-based, infer from context)
3. Skill describes how to query (use `kodex_query_topic` with inferred names)
4. Skill describes when/how to flag (only after code verification)
5. Skill includes MCP tool reference table

**Decisions:**
- Query topics based on judgment (whenever Claude thinks it would help)
- Infer topic names from context rather than listing all topics first
- Only flag topics after verifying discrepancy against actual code
- No topic creation/update in this skill (human-driven workflow)

---

### Item 2: Integrate Kodex into brainstorming
**Type:** code
**Status:** documented
**Problem/Goal:**
The brainstorming-exploring skill gathers context from files and git but doesn't leverage project knowledge stored in Kodex. Claude misses established patterns, conventions, and decisions that could inform the design.

**Approach:**
1. Add new "Step 0: Query Kodex" to brainstorming-exploring/SKILL.md
2. Infer topic names from work item title/description
3. Query each inferred topic using `kodex_query_topic`
4. If no results, try keyword-based fallback
5. Display found topics as context before reading files

**Success Criteria:**
1. brainstorming-exploring/SKILL.md includes Kodex query step
2. Step appears before "Check project state"
3. Includes topic inference logic (item-based + keyword fallback)
4. Includes example tool call

**Decisions:**
- Query Kodex at the very start (before reading files)
- Infer topics from item title first, keywords as fallback

---

### Item 3: Integrate Kodex into rough-draft
**Type:** code
**Status:** documented
**Problem/Goal:**
The rough-draft phases (interface, pseudocode, skeleton) don't leverage project knowledge from Kodex. Each phase produces artifacts without awareness of established patterns, type conventions, error handling approaches, or file structure standards.

**Approach:**
1. Add "Step 0: Query Kodex" to each rough-draft sub-skill:
   - **rough-draft-interface:** Query topics like `{item}-types`, `type-conventions`, `{item}-patterns`
   - **rough-draft-pseudocode:** Query topics like `{item}-error-handling`, `error-patterns`, `{item}-logic`
   - **rough-draft-skeleton:** Query topics like `{item}-file-structure`, `file-naming`, `directory-conventions`
2. Topic inference combines work item context + phase focus
3. Query happens before reading design doc content for that phase

**Success Criteria:**
1. `rough-draft-interface/SKILL.md` includes Kodex query step for type/pattern topics
2. `rough-draft-pseudocode/SKILL.md` includes Kodex query step for error handling/logic topics
3. `rough-draft-skeleton/SKILL.md` includes Kodex query step for file structure topics
4. Each step shows topic inference logic (work item + phase focus)
5. Each step includes example tool call

**Decisions:**
- Query Kodex at start of each phase (before reading design doc for that phase)
- Phase-specific topic focus: interface → types/patterns, pseudocode → error handling/logic, skeleton → file structure
- Infer topic names from work item context + phase focus
- No Kodex integration in rough-draft-handoff (just hands off to executing-plans)

---

## Diagrams
(auto-synced)
