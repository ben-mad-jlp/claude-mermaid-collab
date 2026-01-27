# Session: clear-fair-harbor

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Add Kodex skills to generate or update documents for flagged topics
**Type:** code
**Status:** documented
**Problem/Goal:**
Kodex can flag topics (outdated, incorrect, incomplete, missing) but has no workflow to fix them. Need skills that can generate or update topic content for all flag types.

**Approach:**
- Manual skill invocation (user runs command like /kodex-fix)
- Hybrid content generation: auto-analyze codebase, then validate with user
- Creates draft requiring human approval before going live
- Generates all 4 topic sections: conceptual, technical, files, related
- Parent-child skill structure: main skill routes to sub-skills per flag type

**Success Criteria:**
- Can address all flag types (outdated, incorrect, incomplete, missing)
- Generates accurate content by analyzing referenced codebase files
- Creates drafts (not live content) for human review
- Flags auto-resolve when drafts are approved

**Decisions:**
- Files to create:
  - `skills/kodex-fix/SKILL.md` - Parent skill (user-invocable)
  - `skills/kodex-fix-outdated/SKILL.md` - Sub-skill for outdated flags
  - `skills/kodex-fix-incorrect/SKILL.md` - Sub-skill for incorrect flags
  - `skills/kodex-fix-incomplete/SKILL.md` - Sub-skill for incomplete flags
  - `skills/kodex-fix-missing/SKILL.md` - Sub-skill for missing flags

---

## Design

### Parent Skill: kodex-fix

The parent skill `/kodex-fix` is user-invocable and orchestrates the fix workflow:

**Step 1: List Open Flags**
- Call `kodex_list_flags` with status="open"
- Display flags with topic name, type, and description
- If no open flags, inform user and exit

**Step 2: Select Flag**
- Present flags as numbered list
- User selects which flag to address
- If multiple flags for same topic, can batch them

**Step 3: Route to Sub-Skill**
- Based on flag type, invoke appropriate sub-skill:
  - `outdated` → `kodex-fix-outdated`
  - `incorrect` → `kodex-fix-incorrect`
  - `incomplete` → `kodex-fix-incomplete`
  - `missing` → `kodex-fix-missing`
- Pass topic name and flag details to sub-skill

**Step 4: Completion**
- Sub-skill creates draft and returns
- Parent skill confirms: "Draft created for [topic]. Review in Kodex UI."
- Ask: "Fix another flag?" to continue loop

**Allowed Tools:**
- `kodex_list_flags`, `kodex_list_topics`
- Sub-skill invocation via `Skill` tool

### Sub-Skills: Content Generation

All sub-skills follow a common pattern with variations for their flag type:

**Common Flow:**

1. **Read Context**
   - Get existing topic via `kodex_query_topic` (except `missing`)
   - Read flag description to understand what's wrong
   - Extract file paths from topic's `files` section

2. **Analyze Codebase**
   - Use `Glob` and `Grep` to find relevant files
   - Use `Read` to examine file contents
   - Build understanding of current implementation

3. **Generate Content**
   - `conceptual`: High-level overview of the component
   - `technical`: Implementation details, patterns used
   - `files`: List of related source files
   - `related`: Links to related Kodex topics

4. **Validate with User**
   - Present generated content section by section
   - Ask: "Does this look accurate?" for each
   - Allow user to provide corrections

5. **Create Draft**
   - Call `kodex_update_topic` (or `kodex_create_topic` for missing)
   - Draft requires human approval before going live

**Variations by Type:**

| Type | Focus | Special Handling |
|------|-------|------------------|
| `outdated` | Refresh stale info | Compare old vs current code |
| `incorrect` | Fix factual errors | Focus on flag description |
| `incomplete` | Fill gaps | Add missing sections |
| `missing` | Create from scratch | No existing topic to read |

**Allowed Tools (all sub-skills):**
- `kodex_query_topic`, `kodex_update_topic`, `kodex_create_topic`
- `Glob`, `Grep`, `Read` for codebase analysis
- `AskUserQuestion` for validation

### Flag Resolution Workflow

Flags are resolved when drafts are approved, not when drafts are created:

**Draft Creation (skill does this):**
- Skill generates content and creates draft
- Flag remains **open** at this point
- User is directed to Kodex UI to review

**Draft Approval (human does this):**
- Human reviews draft in Kodex UI
- On "Approve": draft content goes live, flag auto-resolves
- On "Reject": draft is deleted, flag remains open

**Implementation:**
- Modify `approveDraft()` in `kodex-manager.ts` to:
  1. Move draft content to live
  2. Find open flags for this topic
  3. Update flag status to "resolved"
- No changes needed to skill - just calls existing MCP tools

**Why resolve on approval (not draft creation):**
- Draft might be rejected → flag should stay open
- Human reviews content before it affects flag status
- Cleaner separation: skills create drafts, humans approve them

---

## Diagrams
- [approach-skill-flow](http://localhost:3737/diagram.html?project=%2FUsers%2Fbenmaderazo%2FCode%2Fclaude-mermaid-collab&session=clear-fair-harbor&id=approach-skill-flow)