# Collab Workflow Redesign

## Problem / Goal

The current collab workflow treats each session as working on a single item. The proposed workflow supports **multiple work items per session** with:
- Upfront goal gathering
- Per-item routing (bugfix → debugging, feature → brainstorming)
- Investigation-only debugging (no fixing during discovery)
- Work item loop that processes items one at a time

## Key Decisions

1. **gather-session-goals** → New standalone skill (`gather-session-goals/SKILL.md`)
2. **Work item loop** → Lives in collab skill (single orchestrator, prevents drift)
3. **systematic-debugging** → Always investigation-only (documents root cause, never fixes)
4. **Collab is required entry point** → Skills refuse to run outside collab session
5. **Design doc structure** → Both session-level and per-item sections
6. **ready-to-implement behavior** → Parses new doc structure, checks each item's Status field
7. **Session resume** → Always routes through ready-to-implement as single checkpoint

## Success Criteria

1. **New session flow works end-to-end:**
   - `/collab` → gather-session-goals → work item loop → ready-to-implement → rough-draft
   - Multiple work items can be gathered and processed

2. **Work item routing works correctly:**
   - Bugfix items route to systematic-debugging
   - Feature/refactor/spike items route to brainstorming
   - Each item gets documented before moving to next

3. **Investigation-only debugging enforced:**
   - systematic-debugging produces documentation only
   - No code changes during debugging phase
   - Root cause and approach documented in design doc

4. **Resume flow works:**
   - Resuming any session goes through ready-to-implement
   - Incomplete items detected and returned to loop
   - Complete items proceed to rough-draft

5. **Collab-required check enforced:**
   - Running `/brainstorming` without active session shows error
   - Running `/systematic-debugging` without active session shows error
   - Only `/collab` works without existing session

6. **Design doc structure validated:**
   - Work items have all required fields (Type, Status, Problem/Goal, etc.)
   - Status transitions work (pending → documented)

## Out of Scope

1. **Changes to rough-draft skill** - The rough-draft skill continues to work as-is; it receives all documented items and processes them together

2. **Changes to executing-plans skill** - No changes needed; it executes whatever rough-draft produces

3. **Changes to verify-phase skill** - No changes needed; it validates rough-draft output against design

4. **Changes to finishing-a-development-branch** - No changes needed

5. **Changes to collab-cleanup** - No changes needed

6. **MCP server changes** - The mermaid-collab server doesn't need updates; skills use existing tools

7. **Hook changes** - Existing hooks continue to work; no new hooks required for this redesign

8. **Migration of existing sessions** - Old sessions with old doc format are not auto-migrated; users start fresh sessions

---

## Design Doc Structure

```markdown
# Session: <name>

## Session Context
**Out of Scope:** (session-wide boundaries)
**Shared Decisions:** (cross-cutting choices)

---

## Work Items

### Item 1: <title>
**Type:** feature|bugfix|refactor|spike
**Status:** pending|documented
**Problem/Goal:**
**Approach:**
**Root Cause:** (if bugfix)
**Success Criteria:**
**Decisions:** (item-specific)

### Item 2: ...

---

## Diagrams
(auto-synced)
```

---

## Design Details

### gather-session-goals Skill

**Purpose:** Collect and classify work items at the start of a collab session.

**Location:** `skills/gather-session-goals/SKILL.md`

**Invoked by:** collab skill after creating a new session

**Process:**

1. **Ask open question:** "What do you want to accomplish this session?"
2. **Explore iteratively:** Ask follow-up questions one at a time:
   - "Any bugs you're trying to fix?"
   - "Any new features to add?"
   - "Any code to refactor or clean up?"
   - "Any unknowns to investigate (spikes)?"
3. **Classify each item:** As user describes items, classify as feature/bugfix/refactor/spike
4. **Present summary:** Show numbered list with classifications for confirmation
5. **Get confirmation:** User approves list or requests changes
6. **Write to design doc:** Create Work Items section with each item in pending status

**Output:** Design doc populated with classified work items, all with `Status: pending`

**Returns to:** collab skill (which manages the work item loop)

**Key constraints:**
- One question at a time (no batching)
- Don't skip classification step
- Must get explicit confirmation before writing to doc

---

### collab Skill Updates (Work Item Loop)

**Changes to:** `skills/collab/SKILL.md`

**New flow for new sessions:**
1. Check server (unchanged)
2. Find/create session (unchanged)
3. **NEW:** Invoke gather-session-goals skill
4. **NEW:** Enter work item loop

**Work Item Loop logic:**

```
LOOP:
  1. Read design doc, find first item with Status: pending
  2. If no pending items → exit loop, go to ready-to-implement
  3. Get item type
  4. Route by type:
     - bugfix → invoke systematic-debugging (for this item)
     - feature/refactor/spike → invoke brainstorming (for this item)
  5. When skill returns, update item Status: pending → documented
  6. Go to LOOP
```

**Resume flow (simplified):**
1. Check server
2. Show session list, user selects session
3. **Always** invoke ready-to-implement
4. ready-to-implement routes appropriately (back to loop or forward to rough-draft)

**State tracking:** collab-state.json gains `currentItem` field to track which work item is being processed (for context recovery).

**Key principle:** Collab skill is the orchestrator. Other skills do their work and return. Collab maintains the loop.

---

### systematic-debugging Updates (Investigation-Only)

**Changes to:** `skills/systematic-debugging/SKILL.md`

**Core change:** The skill becomes investigation-only. It never implements fixes.

**Process (mostly unchanged):**
1. Read error messages carefully (stack traces, line numbers)
2. Reproduce consistently (exact steps, every time?)
3. Check recent changes (git diff, new deps)
4. Trace data flow (using root-cause-tracing.md)
5. Form hypothesis: "X is root cause because Y"
6. Test minimally: ONE change at a time (read-only tests, not fixes)
7. If root cause found → document and return
8. If 3+ failed hypotheses → STOP, question architecture, discuss with human

**New output requirements:**

When root cause is found, update the work item in design doc:
- **Root Cause:** Clear explanation of what's wrong and why
- **Approach:** Proposed fix strategy (without implementing)
- **Success Criteria:** How to verify the fix worked

**Explicit prohibition:**
```
⚠️ DO NOT IMPLEMENT FIXES
- No editing source files to fix the bug
- No writing fix code
- Document only
- Fixes happen later via rough-draft → executing-plans
```

**Returns to:** collab skill (which marks item as documented and continues loop)

---

### Collab-Required Check (All Skills)

**Principle:** Collab is the required entry point. Skills refuse to run standalone.

**Skills that need this check:**
- brainstorming
- systematic-debugging
- rough-draft
- ready-to-implement
- executing-plans
- gather-session-goals

**Implementation:** Add a guard section at the top of each skill:

```markdown
## Collab Session Required

Before proceeding, check for active collab session:

1. Check if `.collab/` directory exists
2. Check if any session folders exist within
3. If no session found:
   ```
   ⚠️ No active collab session found.
   
   Use /collab to start a session first.
   ```
   **STOP** - do not proceed with this skill.

4. If multiple sessions exist, check `COLLAB_SESSION_PATH` env var or ask user which session.
```

**Exception:** The `collab` skill itself doesn't need this check (it's the entry point).

**Benefits:**
- Enforces full workflow (no shortcuts)
- All work is tracked in design docs
- Prevents orphaned work that bypasses documentation

---

### ready-to-implement Updates

**Changes to:** `skills/ready-to-implement/SKILL.md`

**New role:** Central checkpoint for all resumes and pre-implementation validation.

**Process:**

1. **Read design doc** - Parse the Work Items section
2. **Check each item's Status field:**
   - Count items with `Status: pending`
   - Count items with `Status: documented`
3. **If any pending items exist:**
   ```
   Work items still need documentation:
   
   - [ ] Item 2: Add user authentication (pending)
   - [ ] Item 4: Fix login redirect bug (pending)
   
   Returning to work item loop...
   ```
   **Return to collab skill** → continues work item loop
   
4. **If all items documented:**
   ```
   All work items documented:
   
   - [x] Item 1: Refactor database layer (documented)
   - [x] Item 2: Add user authentication (documented)
   - [x] Item 3: Fix login redirect bug (documented)
   
   Ready to proceed to rough-draft? (y/n)
   ```

5. **On confirmation:**
   - Update collab-state.json phase to `rough-draft/interface`
   - Invoke rough-draft skill

**Key change from current:** No longer checks for "decision markers" in freeform text. Instead parses structured `Status:` field per work item.

**Integration point:** This is where resume flow and new-session flow converge before rough-draft.