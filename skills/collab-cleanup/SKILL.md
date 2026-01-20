---
name: collab-cleanup
description: Close out a collab session - archive or delete design artifacts
---

# Collab Cleanup

## Overview

Close a collab session after development is complete. Offers choices to archive design artifacts, delete them, or keep the session open for reference.

**Announce at start:** "I'm using the collab-cleanup skill to close this session."

## Workflow

### Step 1: Identify Current Session

1. Call `mcp__mermaid__get_storage_config()` to get current storage path
2. Extract session name from path (e.g., `.collab/glowing-sunny-mesa/` → `glowing-sunny-mesa`)
3. If storage points to a collab session:
   - Display: "Current session: **[name]** ([template])"
   - Ask: "Clean up this session? (y/n)"
4. If storage doesn't point to a collab session:
   - Call `mcp__mermaid__list_collab_sessions()`
   - If sessions exist: List them, ask which to clean up
   - If no sessions: "No collab sessions found." and exit

### Step 2: Show Session Summary

Display session details:

```
Session: [name]
Template: [feature/bugfix/refactor/spike]
Phase: [current phase]

Artifacts:
- Documents: [list .md files]
- Diagrams: [list .mmd files]
```

### Step 3: Ask User Choice

```
What would you like to do with the design artifacts?

1. Archive - Copy to docs/designs/[session-name]/
2. Delete - Remove without saving
3. Keep - Leave session in place, exit without cleanup
```

### Step 4: Execute Choice

**If Archive:**
1. Create `docs/designs/[session-name]/` directory
2. Copy `.collab/[session]/documents/*` to `docs/designs/[session-name]/`
3. Copy `.collab/[session]/diagrams/*` to `docs/designs/[session-name]/`
4. Delete `.collab/[session]/` folder
5. Report what was archived

**If Delete:**
1. Confirm: "Delete session [name]? This cannot be undone. (y/n)"
2. If confirmed: Delete `.collab/[session]/` folder
3. If not confirmed: Return to Step 3

**If Keep:**
1. Exit without changes
2. Remind user: "Session kept open. Run `/collab-cleanup` when ready to close."

### Step 5: Confirm

Display completion message:

- Archive: "Session `[name]` archived to `docs/designs/[name]/`"
- Delete: "Session `[name]` deleted."
- Keep: "Session `[name]` kept open."

## Integration

**Called by:**
- `finishing-a-development-branch` skill at completion
- User directly via `/collab-cleanup` command

**Collab workflow position:**
```
collab → brainstorming → rough-draft → executing-plans → finishing-a-development-branch → collab-cleanup
                                                                                              ↑
                                                                                        (you are here)
```

## Common Mistakes

### Archiving without checking contents
- **Problem:** Archived files might be incomplete or contain sensitive info
- **Fix:** Always show session summary before archiving

### Deleting active session
- **Problem:** User accidentally deletes session they're still working on
- **Fix:** Confirm deletion, check if phase is not "implementation"

## Red Flags

**Never:**
- Delete without confirmation
- Archive to a location that already exists (overwrite)
- Clean up if there are pending verification issues

**Always:**
- Show session summary before action
- Confirm destructive actions
- Report what was done
