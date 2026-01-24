# Skeleton: Item 10 - Always Allow Mermaid MCP Commands

## File Stubs

### .claude/settings.local.json (NEW)
```json
{
  "allowedTools": [
    "mcp__mermaid__*",
    "mcp__plugin_mermaid-collab_mermaid__*"
  ]
}
```

### setup.sh (MODIFY)
```bash
# TODO: Add section to create .claude/settings.local.json
# - Create .claude directory if needed
# - Write settings.local.json with allowedTools
# - Print confirmation message
```

### README.md (MODIFY)
```markdown
## MCP Tool Permissions

The plugin configures `.claude/settings.local.json` to auto-allow
all mermaid-collab MCP tools.

<!-- TODO: Add documentation about permissions -->
```

## Task Dependency Graph

```yaml
tasks:
  - id: create-settings
    files: [.claude/settings.local.json]
    description: Create settings.local.json with allowedTools configuration
    parallel: true

  - id: update-setup
    files: [setup.sh]
    description: Add settings.local.json creation to setup script
    depends-on: [create-settings]

  - id: document-permissions
    files: [README.md]
    description: Document MCP tool permissions in README
    parallel: true
```
