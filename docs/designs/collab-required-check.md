# Collab-Required Check Pattern

**Source:** Collab Workflow Redesign (pure-light-beach session)

## Overview

Collab is the required entry point. Skills refuse to run standalone.

## Skills That Need This Check

- brainstorming
- systematic-debugging
- rough-draft
- ready-to-implement
- executing-plans
- gather-session-goals

## Skills That Don't Need This Check

- collab (it's the entry point)

---

## Markdown Snippet to Copy

Copy this section verbatim to the TOP of each skill listed above:

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

---

## Implementation Logic (Reference)

The pseudocode for the check:

```
FUNCTION checkCollabSession():
  # Check .collab directory exists
  IF NOT exists(".collab/"):
    DISPLAY:
      "⚠️ No active collab session found."
      ""
      "Use /collab to start a session first."
    STOP - do not proceed

  # Check for session folders
  sessions = listDirectories(".collab/")
  IF sessions.length == 0:
    DISPLAY:
      "⚠️ No active collab session found."
      ""
      "Use /collab to start a session first."
    STOP - do not proceed

  # Single session - use it
  IF sessions.length == 1:
    RETURN sessions[0]

  # Multiple sessions - check env var
  IF env.COLLAB_SESSION_PATH exists:
    session_name = parseSessionName(env.COLLAB_SESSION_PATH)
    IF session_name in sessions:
      RETURN session_name

  # Multiple sessions - ask user
  ASK user: "Multiple sessions found. Which one?"
  OPTIONS: sessions
  RETURN user_selection
```

---

## Benefits

- Enforces full workflow (no shortcuts)
- All work is tracked in design docs
- Prevents orphaned work that bypasses documentation
