## hooks.json Format

```json
{
  "description": "Hook configuration",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool-pattern",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/script.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

## Hook Configurations

### Server Auto-Start
```json
{
  "matcher": "mcp__.*mermaid__.*",
  "hooks": [{ "command": "server-check.sh", "timeout": 15 }]
}
```
Runs before any mermaid MCP tool, ensures server is running.

### Brainstorming Enforcement
```json
{
  "matcher": "Write|Edit",
  "hooks": [{ "command": "brainstorming-enforce.sh", "timeout": 5 }]
}
```
Blocks file edits during brainstorming phase.

### Diagram Sync
```json
{
  "matcher": "mcp__.*mermaid__create_diagram|mcp__.*mermaid__update_diagram",
  "hooks": [{ "command": "sync-diagram-to-doc.sh", "timeout": 10 }]
}
```
Updates design doc after diagram changes.

### Pre-Compact
```json
{
  "matcher": "",
  "hooks": [{ "command": "pre-compact.sh", "timeout": 5 }]
}
```
Saves snapshot before context compaction.

## Environment Variables

- `CLAUDE_PLUGIN_ROOT` - Plugin installation directory
- `TOOL_NAME` - Name of tool being called
- `TOOL_ARGS` - JSON arguments to the tool