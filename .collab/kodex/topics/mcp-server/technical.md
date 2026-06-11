## Server Setup (`setup.ts`)

The `setupMCPServer()` function creates and configures the MCP server with all tools:

### Tool Categories

**Session Tools**
- `generate_session_name` - Creates memorable names (adjective-adjective-noun)
- `list_sessions` - Lists all registered collab sessions

**Diagram Tools**
- `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`
- `validate_diagram` - Validates Mermaid syntax without saving
- `preview_diagram` - Gets browser preview URL
- `transpile_diagram` - Converts SMACH to Mermaid
- `patch_diagram` - Search-replace for small edits

**Document Tools**
- `list_documents`, `get_document`, `create_document`, `update_document`
- `preview_document`, `patch_document`

**UI Tools**
- `render_ui` - Pushes JSON UI definitions to browser
- `update_ui` - Partial patch updates
- `dismiss_ui` - Clears UI from browser

**Session State Tools**
- `get_session_state`, `update_session_state`
- `has_snapshot`, `save_snapshot`, `load_snapshot`, `delete_snapshot`

**Terminal Tools**
- `terminal_create_session`, `terminal_list_sessions`
- `terminal_kill_session`, `terminal_rename_session`, `terminal_reorder_sessions`

**Kodex Tools**
- `kodex_query_topic`, `kodex_list_topics`, `kodex_create_topic`, `kodex_update_topic`
- `kodex_flag_topic`, `kodex_verify_topic`
- `kodex_list_drafts`, `kodex_approve_draft`, `kodex_reject_draft`
- `kodex_dashboard`, `kodex_list_flags`

## HTTP Transport (`http-transport.ts`)

Implements MCP protocol version 2025-03-26:

```typescript
class StreamableHttpTransport implements Transport {
  handlePost(req: Request): Promise<Response>  // Client → Server
  handleGet(): Response                        // Server → Client (SSE)
  handleDelete(): Response                     // Terminate session
  send(message: JSONRPCMessage): Promise<void> // Send to client
}
```

- POST requests deliver messages and wait for responses (60s timeout)
- GET opens SSE stream for server-initiated notifications
- Validates messages against JSONRPCMessageSchema

## HTTP Handler (`http-handler.ts`)

Manages MCP sessions over HTTP:

```typescript
interface MCPSession {
  transport: StreamableHttpTransport;
  server: Server;
  createdAt: number;
  lastActivity: number;
}
```

- Routes POST/GET/DELETE to appropriate handlers
- Auto-reconnects expired sessions on POST
- Provides `getActiveSessionCount()` and `getSessionInfo()` for debugging