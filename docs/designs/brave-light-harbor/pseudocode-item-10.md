# Pseudocode: Item 10 - Always Allow Mermaid MCP Commands

## Configuration File

```json
// .claude/settings.local.json
{
  "allowedTools": [
    "mcp__mermaid__*",
    "mcp__plugin_mermaid-collab_mermaid__*"
  ]
}
```

## Setup Script Addition

```bash
# In setup.sh, add:

echo "Configuring Claude Code permissions..."
mkdir -p .claude
cat > .claude/settings.local.json << 'EOF'
{
  "allowedTools": [
    "mcp__mermaid__*",
    "mcp__plugin_mermaid-collab_mermaid__*"
  ]
}
EOF
echo "MCP tool permissions configured."
```

## Verification

```
FUNCTION verifyPermissions():
  IF file exists ".claude/settings.local.json":
    content = readJSON(".claude/settings.local.json")
    IF content.allowedTools includes "mcp__mermaid__*":
      PRINT "Mermaid MCP tools auto-allowed"
      RETURN true
  
  PRINT "Warning: MCP tools may require permission prompts"
  RETURN false
```

## Documentation Update

```markdown
# In README.md or setup docs:

## MCP Tool Permissions

The plugin configures `.claude/settings.local.json` to auto-allow
all mermaid-collab MCP tools. This prevents permission prompts
during collaborative design sessions.

Allowed patterns:
- `mcp__mermaid__*` - Direct MCP server tools
- `mcp__plugin_mermaid-collab_mermaid__*` - Plugin-prefixed tools

To manually configure, run:
\`\`\`bash
./setup.sh
\`\`\`
```

## Affected Tools List

```
# All tools that will be auto-allowed:
- generate_session_name
- list_sessions
- list_diagrams, get_diagram, create_diagram, update_diagram
- patch_diagram, preview_diagram, validate_diagram, transpile_diagram
- list_documents, get_document, create_document, update_document
- patch_document, preview_document
- render_ui, update_ui, dismiss_ui
- check_server_health
- get_session_state, update_session_state
- has_snapshot, save_snapshot, load_snapshot, delete_snapshot
```
