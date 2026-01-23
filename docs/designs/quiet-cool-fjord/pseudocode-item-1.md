# Pseudocode: Item 1 - MCP for Session Discovery

## [APPROVED]

## File: skills/collab/session-mgmt.md

### Step 2: Find Sessions

```
FUNCTION findSessions():
  # Call MCP tool instead of bash
  result = mcp__mermaid__list_sessions()
  
  # Filter to current project
  cwd = getCurrentWorkingDirectory()
  projectSessions = []
  
  FOR session IN result.sessions:
    IF session.project == cwd:
      ADD session TO projectSessions
  
  # Handle no sessions
  IF projectSessions.length == 0:
    RETURN { sessions: [], hasExisting: false }
  
  # Sort by lastAccess (most recent first)
  SORT projectSessions BY lastAccess DESC
  
  # Get phase for each session
  FOR session IN projectSessions:
    state = mcp__mermaid__get_session_state(cwd, session.session)
    session.phase = state.phase
    session.relativeTime = formatRelativeTime(session.lastAccess)
  
  RETURN { sessions: projectSessions, hasExisting: true }
```

### Display Sessions

```
FUNCTION displaySessionOptions(sessions):
  # Build options list
  options = []
  
  FOR i, session IN enumerate(sessions):
    label = "{session.session} - {session.phase} (last active: {session.relativeTime})"
    ADD { value: i+1, label: label } TO options
  
  # Always add "create new" option
  ADD { value: sessions.length + 1, label: "Create new session" } TO options
  
  # Show UI
  response = mcp__mermaid__render_ui({
    ui: {
      type: "Card",
      props: { title: "Select Session" },
      children: [{
        type: "RadioGroup",
        props: { name: "session", options: options }
      }],
      actions: [{ id: "select", label: "Continue", primary: true }]
    },
    blocking: true
  })
  
  selectedIndex = parseInt(response.data.session)
  
  IF selectedIndex == sessions.length + 1:
    RETURN { action: "create" }
  ELSE:
    RETURN { action: "resume", session: sessions[selectedIndex - 1] }
```

## Error Handling

```
IF mcp__mermaid__list_sessions() fails:
  # Fall back to checking .collab directory exists
  IF NOT exists(".collab/"):
    RETURN { sessions: [], hasExisting: false }
  ELSE:
    # Report MCP error, suggest server restart
    PRINT "MCP error. Ensure server is running."
    STOP
```

## Verification
- [ ] Uses MCP list_sessions instead of bash ls
- [ ] Filters sessions by current project path
- [ ] Shows relative time since last access
- [ ] Gets phase for each session via get_session_state
