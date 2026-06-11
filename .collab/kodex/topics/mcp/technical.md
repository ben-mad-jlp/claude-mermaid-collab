## Implementation Details

### Server Setup
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server(
  { name: 'mermaid-diagram-server', version: SERVER_VERSION },
  { capabilities: { tools: {}, resources: {} } }
);
```

### Tool Registration
Tools are registered via `ListToolsRequestSchema` and handled via `CallToolRequestSchema`. Each tool has:
- `name`: Tool identifier
- `description`: Human-readable description
- `inputSchema`: JSON Schema for parameters

### API Integration
MCP tools communicate with the HTTP API server at `localhost:3737` for persistence and WebSocket broadcasting.

### Session Parameters
Most tools require `project` (absolute path) and `session` (session name) parameters.