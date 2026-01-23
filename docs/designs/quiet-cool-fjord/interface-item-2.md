# Interface: Item 2 - MCP Usage Default in Collab Setup

## [APPROVED]

## File Structure
- `skills/collab/SKILL.md` - Add MCP-First header, update Step 1
- `skills/collab/session-mgmt.md` - Already covered in Item 1
- `skills/collab/work-item-loop.md` - Update design doc reads

## Changes

### SKILL.md

**Add after frontmatter:**
```markdown
## MCP-First Principle

**Always use MCP tools for session/document operations:**
- Session discovery: `list_sessions`
- Server health: `check_server_health`
- Documents: `get_document`, `list_documents`, `create_document`, `update_document`, `patch_document`
- Diagrams: `get_diagram`, `list_diagrams`, `create_diagram`, `update_diagram`, `patch_diagram`
- State: `get_session_state`, `update_session_state`

**Bash only for:**
- Git commands
- External tools (curl for non-MCP endpoints)
- File operations outside `.collab/`
```

**Update Step 1:**
```markdown
## Step 1: Check Server

```
Tool: mcp__mermaid__check_server_health
Args: {}
```

Returns: `{ "mcp": true, "http": true, "ui": true }` or error

**If not all true:**
```
Server not running. From the plugin directory, run:

  bun run bin/mermaid-collab.ts start

Then run /collab again.
```
```

### work-item-loop.md

**Update Step 4.1:**
```markdown
### 4.1 Read Design Doc

```
Tool: mcp__mermaid__get_document
Args: { "project": "<cwd>", "session": "<name>", "id": "design" }
```
```

## Verification
- [ ] SKILL.md has MCP-First section
- [ ] Step 1 uses check_server_health
- [ ] work-item-loop uses get_document
