# Session: quick-fresh-canyon

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: Don't create .gitignore if it doesn't exist
**Type:** feature
**Status:** documented
**Problem/Goal:**
The collab skill currently runs `echo ".collab/" >> .gitignore` when `.collab` is not already ignored. This creates a `.gitignore` file if one doesn't exist, which may be unwanted in projects that don't use `.gitignore`.

**Approach:**
Modify Step 3.1 in `skills/collab/skill.md` to check if `.gitignore` exists before appending.

**Success Criteria:**
- If `.gitignore` exists and `.collab` not ignored → append `.collab/`
- If `.gitignore` exists and `.collab` already ignored → do nothing
- If `.gitignore` does not exist → do nothing (skip silently)

**Decisions:**
- Skip silently when no `.gitignore` (don't warn user, don't ask)

---

### Item 2: Update design doc after each brainstorming question
**Type:** feature
**Status:** documented
**Problem/Goal:**
If context compaction happens during brainstorming, answers to clarifying questions are lost because they exist only in conversation context.

**Approach:**
Modify the brainstorming skill to incrementally populate work item fields immediately after each relevant answer.

**Success Criteria:**
- Work item fields are populated incrementally as answers come in
- After compaction, resuming can read partially-filled fields and continue

**Decisions:**
- Incrementally populate fields (not Q&A pairs, not separate summaries)

---

### Item 3: Better user feedback when updating files
**Type:** feature
**Status:** documented
**Problem/Goal:**
When skills update files, there's minimal feedback to the user about what's happening.

**Approach:**
Add explicit output messages before and after file updates.

**Success Criteria:**
- User sees a message before each file update indicating what will change
- User sees a confirmation after each file update

**Decisions:**
- Show both before and after messages
- Describe what changed, not just the file path

---

### Item 4: Use numbered options for questions
**Type:** feature
**Status:** documented
**Problem/Goal:**
Skills present options as inline text like `(y/n)` which requires typing words.

**Approach:**
Update all skills to use numbered list format for options.

**Success Criteria:**
- All user-facing options use numbered format
- User can answer with just a number

**Decisions:**
- Apply to all skills (comprehensive change)

---

## Interface Definition

### Files to Modify

| File | Item | Change Type |
|------|------|-------------|
| `skills/collab/SKILL.md` | 1, 3, 4 | .gitignore logic, feedback, numbered options |
| `skills/brainstorming/SKILL.md` | 2, 3, 4 | Incremental updates, feedback, numbered options |
| `skills/gather-session-goals/SKILL.md` | 3, 4 | Feedback, numbered options |
| `skills/collab-cleanup/SKILL.md` | 4 | Numbered options |
| `skills/executing-plans/SKILL.md` | 4 | Numbered options |
| `skills/finishing-a-development-branch/SKILL.md` | 4 | Numbered options |
| `skills/ready-to-implement/SKILL.md` | 4 | Numbered options |
| `skills/rough-draft/SKILL.md` | 4 | Numbered options |
| `skills/verify-phase/SKILL.md` | 4 | Numbered options |

---

## Pseudocode

### Task 1: collab/SKILL.md (Items 1, 3, 4)

**Edit 1.1 - .gitignore check (Item 1):**
Find section "### 3.1 Ensure .gitignore" and replace:
```bash
git check-ignore -q .collab 2>/dev/null || echo ".collab/" >> .gitignore
```
With:
```bash
if [ -f .gitignore ]; then
  git check-ignore -q .collab 2>/dev/null || echo ".collab/" >> .gitignore
fi
```

**Edit 1.2 - Numbered options (Item 4):**
Find and replace all `(y/n)` and similar patterns with numbered lists.

---

### Task 2: brainstorming/SKILL.md (Items 2, 3, 4)

**Edit 2.1 - Incremental updates (Item 2):**
Add new section after "CLARIFYING (scoped to item):" subsection:

```markdown
**Incremental Design Doc Updates:**
After each substantive user answer during CLARIFYING phase:
1. Output: "Updating [field] for Item [N]..."
2. Read current design doc via MCP
3. Update the relevant field (Problem/Goal, Approach, Success Criteria, or Decisions)
4. Write updated doc via MCP
5. Output: "Updated [field] for Item [N]"

This ensures context survives compaction - the design doc is the persistent record.
```

**Edit 2.2 - Numbered options (Item 4):**
Replace `(accept / reject / edit)` with numbered list format.

---

### Task 3: gather-session-goals/SKILL.md (Items 3, 4)

**Edit 3.1 - Feedback (Item 3):**
Add output instructions around the "Write to Design Doc" step.

**Edit 3.2 - Numbered options (Item 4):**
Replace `(yes / add more / remove / edit)` with numbered list.

---

### Task 4: Other skills (Item 4 only)

For each of these files, find and replace option patterns:
- `collab-cleanup/SKILL.md`: `(y/n)` patterns
- `executing-plans/SKILL.md`: `accept/reject` patterns
- `finishing-a-development-branch/SKILL.md`: `(y/n)` patterns
- `ready-to-implement/SKILL.md`: `(y/n)` patterns
- `rough-draft/SKILL.md`: `(y/n)`, `[accept all / reject all / review each]` patterns
- `verify-phase/SKILL.md`: `Accept/Reject/Partial` patterns

---

### Task Dependency Graph

```yaml
tasks:
  - id: collab-skill
    files: [skills/collab/SKILL.md]
    description: Update collab skill with .gitignore check and numbered options
    parallel: true

  - id: brainstorming-skill
    files: [skills/brainstorming/SKILL.md]
    description: Add incremental updates and numbered options
    parallel: true

  - id: gather-goals-skill
    files: [skills/gather-session-goals/SKILL.md]
    description: Add feedback and numbered options
    parallel: true

  - id: other-skills
    files:
      - skills/collab-cleanup/SKILL.md
      - skills/executing-plans/SKILL.md
      - skills/finishing-a-development-branch/SKILL.md
      - skills/ready-to-implement/SKILL.md
      - skills/rough-draft/SKILL.md
      - skills/verify-phase/SKILL.md
    description: Update numbered options in remaining skills
    parallel: true
```

All tasks are parallel-safe (no dependencies between files).

---

## Skeleton

**No new files to create.** All changes are edits to existing skill files.

### Execution Plan

Since all 4 tasks are parallel-safe (no dependencies), they can be executed simultaneously:

| Batch | Tasks | Files |
|-------|-------|-------|
| 1 (parallel) | collab-skill, brainstorming-skill, gather-goals-skill, other-skills | All 9 files |

### Summary
- 9 files to edit
- 0 new files to create
- 4 parallel tasks
- No sequential dependencies

---

## Diagrams
(auto-synced)