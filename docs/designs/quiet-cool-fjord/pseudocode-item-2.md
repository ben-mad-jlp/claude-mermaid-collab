# Pseudocode: Item 2 - MCP Usage Default in Collab Setup

## [APPROVED]

## File: skills/collab/SKILL.md

### Step 1: Check Server (Updated)

```
FUNCTION checkServer():
  # Use MCP health check instead of curl
  TRY:
    result = mcp__mermaid__check_server_health()
    
    IF result.mcp AND result.http AND result.ui:
      RETURN { healthy: true }
    ELSE:
      missing = []
      IF NOT result.mcp: ADD "MCP" TO missing
      IF NOT result.http: ADD "HTTP" TO missing
      IF NOT result.ui: ADD "UI" TO missing
      RETURN { healthy: false, missing: missing }
  
  CATCH error:
    RETURN { healthy: false, error: "Server not reachable" }
```

### Server Not Running Response

```
FUNCTION handleServerDown(result):
  PRINT "Server not running."
  
  IF result.missing:
    PRINT "Missing services: {result.missing.join(', ')}"
  
  PRINT ""
  PRINT "From the plugin directory, run:"
  PRINT ""
  PRINT "  bun run bin/mermaid-collab.ts start"
  PRINT ""
  PRINT "Then run /collab again."
  
  STOP
```

## File: skills/collab/work-item-loop.md

### Step 4.1: Read Design Doc (Updated)

```
FUNCTION readDesignDoc(session):
  # Use MCP instead of cat
  cwd = getCurrentWorkingDirectory()
  
  result = mcp__mermaid__get_document({
    project: cwd,
    session: session,
    id: "design"
  })
  
  RETURN result.content
```

## MCP-First Principle Section

```markdown
## MCP-First Principle

**Always use MCP tools for session/document operations:**

| Operation | MCP Tool |
|-----------|----------|
| Server health | `check_server_health` |
| List sessions | `list_sessions` |
| Session state | `get_session_state`, `update_session_state` |
| Documents | `get_document`, `list_documents`, `create_document`, `update_document`, `patch_document` |
| Diagrams | `get_diagram`, `list_diagrams`, `create_diagram`, `update_diagram`, `patch_diagram` |
| Snapshots | `has_snapshot`, `save_snapshot`, `load_snapshot`, `delete_snapshot` |
| UI | `render_ui`, `update_ui`, `dismiss_ui` |

**Bash only for:**
- Git commands (`git status`, `git commit`, etc.)
- External tools not available via MCP
- File operations outside `.collab/` folder
```

## Verification
- [ ] SKILL.md Step 1 uses check_server_health
- [ ] work-item-loop.md uses get_document
- [ ] MCP-First Principle section added
- [ ] MCP tools table is complete
