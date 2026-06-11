# MCP (Model Context Protocol)

MCP provides the communication layer between Claude Code and the mermaid-collab server. It exposes tools for diagram management, document editing, UI rendering, terminal sessions, and Kodex knowledge base operations.

## Architecture

- **stdio transport**: Legacy server for backwards compatibility (`src/mcp/server.ts`)
- **HTTP transport**: Primary transport via API server (`src/mcp/http-transport.ts`)
- Both transports share the same tool definitions via `setupMCPServer()`

## Tool Categories

1. **Diagram Tools**: create, read, update, validate, transpile diagrams
2. **Document Tools**: create, read, update, patch documents
3. **UI Tools**: render_ui, update_ui, dismiss_ui for browser interaction
4. **Session Tools**: session state, snapshots, archiving
5. **Terminal Tools**: create, list, kill, rename terminal sessions
6. **Kodex Tools**: query, create, update, flag topics
7. **Workflow Tools**: complete_skill for state machine advancement