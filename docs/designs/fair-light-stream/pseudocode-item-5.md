# Pseudocode: Item 5 - Disable tmux terminal splitting

### TerminalManager.createTmuxSession(tmuxSessionName, cwd?)

```
1. TRY:
   a. Create tmux session:
      - IF cwd provided:
        execAsync(`tmux new-session -d -s ${tmuxSessionName} -c ${cwd}`)
      - ELSE:
        execAsync(`tmux new-session -d -s ${tmuxSessionName}`)

   b. Enable mouse scrolling (existing):
      - execAsync(`tmux set-option -t ${tmuxSessionName} mouse on`)

   c. Disable horizontal split (NEW):
      - execAsync(`tmux unbind-key -t ${tmuxSessionName} %`)

   d. Disable vertical split (NEW):
      - execAsync(`tmux unbind-key -t ${tmuxSessionName} '"'`)

2. CATCH error:
   a. IF error contains "duplicate session" or "already exists":
      - Session exists, that's OK
      - Still apply mouse and unbind options (idempotent)
      - Return without throwing

   b. ELSE:
      - Throw Error with context: "Failed to create tmux session {name}: {error}"
```

**Error Handling:**
- Duplicate session: Handled gracefully (existing pattern)
- Unbind failure: Very unlikely, no special handling needed
- tmux not installed: Will fail on first execAsync, error propagates

**Edge Cases:**
- Session name with special chars: Already sanitized by generateTmuxSessionName
- Unbind already unbound key: tmux silently succeeds (idempotent)
- Concurrent session creation: Duplicate check handles race condition

**Dependencies:**
- execAsync (promisified child_process.exec)
- tmux (system binary)
