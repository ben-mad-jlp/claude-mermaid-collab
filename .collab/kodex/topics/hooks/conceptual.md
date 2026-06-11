# Claude Code Hooks

Hooks are shell commands that execute in response to Claude Code events. They enable automation like server auto-start, phase enforcement, and diagram syncing.

## Hook Types

1. **PreToolUse** - Runs before a tool is executed
2. **PostToolUse** - Runs after a tool completes
3. **PreCompact** - Runs before context compaction

## Key Hooks in mermaid-collab

- **server-check.sh** - Auto-starts server before MCP tool calls
- **brainstorming-enforce.sh** - Prevents Write/Edit during brainstorming phase
- **sync-diagram-to-doc.sh** - Syncs diagrams to design doc after creation/update
- **pre-compact.sh** - Saves context snapshot before compaction