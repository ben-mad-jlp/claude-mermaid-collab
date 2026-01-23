# Interface: Item 1 - MCP for Session Discovery

## [APPROVED]

## File Structure
- `skills/collab/session-mgmt.md` - Update Step 2 to use MCP tool

## Changes

### session-mgmt.md Step 2

**Before:**
```markdown
## Step 2: Find Sessions

```bash
ls -d .collab/*/ 2>/dev/null | xargs -I{} basename {}
```
```

**After:**
```markdown
## Step 2: Find Sessions

```
Tool: mcp__mermaid__list_sessions
Args: {}
```

Returns: `{ "sessions": [{ "project": "...", "session": "...", "lastAccess": "..." }, ...] }`

**Filter to current project:**
```
project_sessions = sessions.filter(s => s.project == "<absolute-path-to-cwd>")
```

**Display:**
```
Existing sessions:

1. <session-1> - <phase> (last active: <relative-time>)
2. <session-2> - <phase> (last active: <relative-time>)
3. Create new session

Select option (1-N):
```
```

## Verification
- [ ] Step 2 uses MCP tool instead of bash
- [ ] Results filtered to current project
- [ ] lastAccess shown for recency
