# Interface: Item 10 - Always Allow Mermaid MCP Commands

## File Structure
- `.claude/settings.local.json` - Add allowedTools config (CREATE/MODIFY)
- `README.md` or setup docs - Document the setting

## Configuration

```json
// .claude/settings.local.json
{
  "allowedTools": [
    "mcp__mermaid__*",
    "mcp__plugin_mermaid-collab_mermaid__*"
  ]
}
```

## Tool Patterns

Both patterns needed to cover:
1. `mcp__mermaid__*` - Direct MCP server tools
2. `mcp__plugin_mermaid-collab_mermaid__*` - Plugin-prefixed tools

## Affected Tools

All mermaid-collab MCP tools:
- `create_diagram`, `update_diagram`, `patch_diagram`
- `create_document`, `update_document`, `patch_document`
- `render_ui`, `update_ui`, `dismiss_ui`
- `get_session_state`, `update_session_state`
- `save_snapshot`, `load_snapshot`, `delete_snapshot`
- `preview_diagram`, `preview_document`
- `list_diagrams`, `list_documents`
- `validate_diagram`, `transpile_diagram`
- `generate_session_name`, `list_sessions`
- `check_server_health`, `has_snapshot`

## Setup Instructions

Add to project setup:
```bash
mkdir -p .claude
cat > .claude/settings.local.json << 'EOF'
{
  "allowedTools": [
    "mcp__mermaid__*",
    "mcp__plugin_mermaid-collab_mermaid__*"
  ]
}
EOF
```
