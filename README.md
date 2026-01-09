# Mermaid Collaboration Server

A real-time Mermaid diagram collaboration server with integrated Model Context Protocol (MCP) support for Claude Code.

## Features

- **Web Dashboard**: Browse diagrams with thumbnails, search, and filter
- **Split-Pane Editor**: Live preview with syntax validation, undo/redo, theme switching
- **Real-Time Collaboration**: WebSocket-based live updates across all connected clients
- **File-Based Storage**: Simple `.mmd` files for version control and external editing
- **Syntax Validation**: Block invalid saves with line-specific error reporting
- **MCP Integration**: Claude Code can create, read, update, and preview diagrams
- **Export**: Download diagrams as SVG or PNG
- **LAN Accessible**: Share with team members on local network

## Quick Start

### Installation

```bash
bun install
```

### Start Web Server

```bash
bun run dev
```

The server starts on `http://0.0.0.0:3737` by default.

### Start MCP Server (for Claude Code)

```bash
bun run mcp
```

See [docs/MCP_SETUP.md](docs/MCP_SETUP.md) for Claude Code configuration.

## Usage

### Web Interface

**Dashboard** (`http://localhost:3737/`)
- View all diagrams as thumbnails
- Search by name
- Click to open in editor
- Connection status indicator (top-right)

**Editor** (`http://localhost:3737/diagram.html?id=<diagram-id>`)
- Split-pane: code on left, preview on right
- Auto-save with 500ms debounce
- Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
- Theme switcher (default, dark, forest, neutral)
- Export SVG/PNG
- Pan and zoom preview

### MCP Tools (via Claude Code)

Claude Code can manage diagrams through six MCP tools:

- `list_diagrams()` - List all diagrams with metadata
- `get_diagram(id)` - Read diagram content
- `create_diagram(name, content)` - Create new diagram (validates first)
- `update_diagram(id, content)` - Update existing diagram (validates first)
- `validate_diagram(content)` - Check Mermaid syntax without saving
- `preview_diagram(id)` - Get browser URL for diagram

See [docs/MCP_SETUP.md](docs/MCP_SETUP.md) for detailed MCP usage.

### REST API

**List diagrams**
```
GET /api/diagrams
```

**Get diagram**
```
GET /api/diagram/:id
```

**Create diagram**
```
POST /api/diagram
Content-Type: application/json

{
  "name": "my-diagram",
  "content": "graph TD\n  A-->B"
}
```

**Update diagram**
```
POST /api/diagram/:id
Content-Type: application/json

{
  "content": "graph TD\n  A-->B\n  B-->C"
}
```

**Delete diagram**
```
DELETE /api/diagram/:id
```

**Validate syntax**
```
POST /api/validate
Content-Type: application/json

{
  "content": "graph TD\n  A-->B"
}
```

**Render SVG**
```
POST /api/render
Content-Type: application/json

{
  "content": "graph TD\n  A-->B",
  "theme": "default"
}
```

**Get thumbnail**
```
GET /api/thumbnail/:id
```

## Configuration

Set environment variables to customize behavior:

```bash
# Server configuration
PORT=3737                    # Server port (default: 3737)
HOST=0.0.0.0                 # Bind address (default: 0.0.0.0)

# Storage
DIAGRAMS_FOLDER=./diagrams   # Diagram storage path (default: ./diagrams)
```

## Architecture

### Two-Server Model

1. **Web Server** (`bun run dev`)
   - Persistent, shared by all users
   - Hosts dashboard, editor, and REST API
   - Manages file storage and WebSocket connections
   - Runs on configurable port (default: 3737)

2. **MCP Server** (`bun run mcp`)
   - One per Claude Code instance
   - Lightweight stdio wrapper around HTTP API
   - Auto-starts web server if not running
   - Enables Claude to manage diagrams

### Services

- **DiagramManager**: CRUD operations with in-memory indexing
- **Validator**: Mermaid syntax validation via `mermaid.parse()`
- **Renderer**: Server-side SVG generation with jsdom
- **FileWatcher**: Monitors `.mmd` files with chokidar
- **WebSocketHandler**: Real-time update broadcasting

### File Structure

```
.
├── src/
│   ├── config.ts              # Configuration
│   ├── types.ts               # TypeScript interfaces
│   ├── server.ts              # Main web server
│   ├── services/
│   │   ├── diagram-manager.ts # CRUD operations
│   │   ├── validator.ts       # Syntax validation
│   │   ├── renderer.ts        # SVG rendering
│   │   ├── file-watcher.ts    # File monitoring
│   │   └── dom-setup.ts       # jsdom polyfill
│   ├── websocket/
│   │   └── handler.ts         # WebSocket management
│   ├── routes/
│   │   └── api.ts             # REST API endpoints
│   └── mcp/
│       └── server.ts          # MCP server
├── public/
│   ├── index.html             # Dashboard
│   ├── diagram.html           # Editor
│   ├── css/
│   │   └── styles.css         # Global styles
│   └── js/
│       ├── api-client.js      # HTTP & WebSocket client
│       ├── dashboard.js       # Dashboard logic
│       └── editor.js          # Editor logic
└── diagrams/                  # Diagram storage (.mmd files)
```

## Development

### Requirements

- Bun >= 1.0.0

### Build

No build step required - Bun runs TypeScript directly.

### Testing

Run integration tests:

```bash
# Start server
bun run dev

# Open dashboard
open http://localhost:3737

# Create test diagram
curl -X POST http://localhost:3737/api/diagram \
  -H "Content-Type: application/json" \
  -d '{"name":"test","content":"graph TD\n  A-->B"}'
```

## License

MIT
