## Source Files

- `src/mcp/server.ts` - Stdio transport entry point, checks API health before starting
- `src/mcp/setup.ts` - MCP server configuration, tool definitions, request handlers
- `src/mcp/http-handler.ts` - HTTP session management, request routing
- `src/mcp/http-transport.ts` - StreamableHttpTransport implementation
- `src/mcp/tools/render-ui.ts` - UI rendering tool
- `src/mcp/tools/update-ui.ts` - UI patch updates
- `src/mcp/tools/dismiss-ui.ts` - UI dismissal
- `src/mcp/tools/terminal-sessions.ts` - Terminal session management
- `src/mcp/tools/collab-state.ts` - Session state persistence
- `src/mcp/__tests__/server.test.ts` - Server tests