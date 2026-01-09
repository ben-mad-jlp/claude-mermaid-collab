# MCP Setup Guide

This guide explains how to configure Claude Code to use the Mermaid Collaboration Server via Model Context Protocol (MCP).

## Overview

The MCP server provides six tools that allow Claude to manage Mermaid diagrams programmatically:

- `list_diagrams` - List all diagrams with metadata
- `get_diagram` - Read diagram content by ID
- `create_diagram` - Create new diagram with validation
- `update_diagram` - Update existing diagram with validation
- `validate_diagram` - Validate Mermaid syntax without saving
- `preview_diagram` - Get browser URL to view diagram

## Prerequisites

1. **Web server must be accessible** - The MCP server makes HTTP calls to `http://localhost:3737` by default
2. **Bun runtime installed** - Required to run the MCP server

## Configuration

### Step 1: Locate Your Claude Code Config

Claude Code's MCP servers are configured in:

```
~/.config/claude-code/settings.json
```

### Step 2: Add MCP Server Entry

Edit `settings.json` and add the Mermaid server to the `mcpServers` object:

```json
{
  "mcpServers": {
    "mermaid": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/claude-mermaid-collab/src/mcp/server.ts"],
      "env": {
        "PORT": "3737",
        "HOST": "localhost",
        "DIAGRAMS_FOLDER": "/absolute/path/to/diagrams"
      }
    }
  }
}
```

**Important**: Replace `/absolute/path/to/` with the actual absolute paths on your system.

### Step 3: Restart Claude Code

The MCP server will start automatically when Claude Code launches.

## Auto-Start Behavior

The MCP server automatically starts the web server if it's not running:

1. **First launch**: MCP server checks `http://localhost:3737/api/diagrams`
2. **If not running**: Spawns `bun run src/server.ts` in detached mode
3. **Waits**: Polls for 5 seconds until server responds
4. **Ready**: All MCP tools now work

This means you don't need to manually start the web server - Claude Code will do it automatically.

## Usage Examples

### List All Diagrams

```
Claude, list all the mermaid diagrams we have.
```

Claude will call `list_diagrams()` and show:
- Diagram IDs
- File names
- Last modified timestamps

### Get Diagram Content

```
Claude, show me the content of diagram "architecture".
```

Claude will call `get_diagram("architecture")` and display the Mermaid code.

### Create New Diagram

```
Claude, create a new diagram called "user-flow" with this content:

graph TD
  Start-->Login
  Login-->Dashboard
  Dashboard-->End
```

Claude will:
1. Call `validate_diagram(content)` to check syntax
2. If valid, call `create_diagram("user-flow", content)`
3. Return success message with browser URL

### Update Existing Diagram

```
Claude, update the "architecture" diagram to add a new database node.
```

Claude will:
1. Call `get_diagram("architecture")` to read current content
2. Modify the content (add database node)
3. Call `validate_diagram(newContent)` to check syntax
4. If valid, call `update_diagram("architecture", newContent)`
5. Return success message

### Validate Syntax

```
Claude, is this valid Mermaid syntax?

graph TD
  A->B
  B->
```

Claude will call `validate_diagram(content)` and report:
- Valid: `true/false`
- Error message (if invalid)
- Line number (if available)

### Preview Diagram

```
Claude, give me the URL to view diagram "user-flow".
```

Claude will call `preview_diagram("user-flow")` and return:
```
http://localhost:3737/diagram.html?id=user-flow
```

## Environment Variables

You can customize the MCP server behavior via `env` in your config:

```json
{
  "env": {
    "PORT": "3737",           // Web server port
    "HOST": "localhost",       // Web server host
    "DIAGRAMS_FOLDER": "./diagrams"  // Diagram storage path
  }
}
```

**Default values** (if not specified):
- `PORT`: `3737`
- `HOST`: `0.0.0.0`
- `DIAGRAMS_FOLDER`: `./diagrams`

## Troubleshooting

### "Web server is not running"

**Cause**: MCP server couldn't connect to web server after 5 seconds.

**Solutions**:
1. Check if port 3737 is available: `lsof -i :3737`
2. Manually start web server: `bun run dev`
3. Check firewall settings
4. Verify `PORT` and `HOST` env vars match

### "Failed to create diagram: Validation failed"

**Cause**: Mermaid syntax is invalid.

**Solution**: Use `validate_diagram` first to check syntax and see error details.

### "ENOENT: no such file or directory"

**Cause**: Absolute path in config is incorrect.

**Solution**: Use `pwd` in the project directory to get the absolute path, then update `settings.json`.

### "Diagram not found"

**Cause**: Diagram ID doesn't exist or was deleted.

**Solution**: Use `list_diagrams` to see available diagram IDs.

## Advanced Usage

### Custom Diagrams Folder

To use a different storage location:

```json
{
  "env": {
    "DIAGRAMS_FOLDER": "/Users/yourname/Documents/mermaid-diagrams"
  }
}
```

The folder will be created automatically if it doesn't exist.

### Multiple MCP Instances

Each Claude Code instance runs its own MCP server, but they all connect to the **same web server**. This enables collaboration:

1. Alice creates diagram via Claude
2. Bob's Claude can immediately list/read/update it
3. Changes sync in real-time via WebSocket

### Integration with Git

Since diagrams are stored as `.mmd` files, you can:

1. Version control them: `git add diagrams/*.mmd`
2. Create branches for diagram experiments
3. Review changes: `git diff diagrams/architecture.mmd`
4. Merge diagram updates from teammates

## Security Note

The web server binds to `0.0.0.0` by default (LAN accessible) with **no authentication**. This is designed for trusted local networks.

For production deployment:
1. Change `HOST` to `127.0.0.1` (localhost only)
2. Add authentication middleware
3. Use HTTPS with proper certificates
4. Set up firewall rules

## See Also

- [README.md](../README.md) - Main project documentation
- [Mermaid Documentation](https://mermaid.js.org/) - Diagram syntax reference
- [MCP Specification](https://modelcontextprotocol.io/) - Protocol details
