# HTTP API Routes

The HTTP API provides RESTful endpoints for the mermaid-collab server. Routes handle diagram/document CRUD, session management, UI rendering, terminal sessions, and Kodex knowledge base operations.

## Server Architecture

The main server (`src/server.ts`) uses Bun.serve and routes requests:

- `/ws` - WebSocket upgrade
- `/mcp` - MCP Streamable HTTP transport
- `/api/kodex/*` - Kodex knowledge base routes
- `/api/*` - Core API routes
- `/*` - Static files from React UI (SPA with fallback)

## Session Scoping

Most API routes require `project` and `session` query parameters to scope operations to a specific collab session. The session path structure is:
```
{project}/.collab/sessions/{session}/
  ├── diagrams/     # .mmd files
  ├── documents/    # .md files
  └── state.json    # Session state
```