# Mermaid Collaboration Server Design

**Date:** 2026-01-09
**Purpose:** Real-time collaborative mermaid diagram editing for teams on LAN

## Overview

This server provides a web-based interface for teams to create, edit, and preview mermaid diagrams in real-time. Multiple developers access the server over LAN without authentication. Claude Code integrates via MCP to create and update diagrams programmatically.

The system uses two servers: a persistent web server that all users share, and lightweight MCP servers (one per Claude instance) that wrap HTTP calls to the web server.

## Architecture

### Two-Server Model

**Web Server** (single shared instance):
- Runs on port 3737, binds to 0.0.0.0 for LAN access
- Serves static HTML/CSS/JS files
- Provides REST API for diagram operations
- Manages WebSocket connections for live updates
- Watches file system for external changes
- Persists diagrams as .mmd files on disk

**MCP Server** (one per Claude instance):
- Connects to Claude Code via stdio
- Wraps web server HTTP API as MCP tools
- Starts web server if not running
- Remains stateless—all state lives in web server

### Component Responsibilities

**Frontend (static files in public/):**
- Dashboard shows diagram grid with thumbnails
- Editor provides split-pane editing with live preview
- WebSocket client maintains connection, shows status, auto-reconnects

**Backend Services:**
- DiagramManager: CRUD operations, maintains in-memory index
- Validator: Checks mermaid syntax, blocks invalid saves
- Renderer: Generates SVG/PNG, creates thumbnails
- FileWatcher: Monitors diagram folder, broadcasts changes

## Project Structure

```
claude-mermaid-collab/
├── src/
│   ├── server.ts                    # Main entry point
│   ├── routes/
│   │   ├── api.ts                   # REST API handlers
│   │   └── static.ts                # Static file serving
│   ├── services/
│   │   ├── diagram-manager.ts       # Core diagram operations
│   │   ├── validator.ts             # Syntax validation
│   │   ├── renderer.ts              # SVG/PNG generation
│   │   └── file-watcher.ts          # File system monitoring
│   ├── websocket/
│   │   └── handler.ts               # WebSocket management
│   └── mcp/
│       └── server.ts                # MCP stdio server
├── public/
│   ├── index.html                   # Dashboard
│   ├── diagram.html                 # Editor/viewer
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── dashboard.js             # Dashboard UI
│       ├── editor.js                # Editor/viewer logic
│       └── api-client.js            # HTTP/WS wrapper
├── diagrams/                        # Diagram storage
└── package.json
```

## REST API

All endpoints return JSON. Validation errors block saves with 400 status.

```
GET  /api/diagrams
     Returns: { diagrams: [{ id, name, content, lastModified }] }

GET  /api/diagram/:id
     Returns: { id, name, content, lastModified }

POST /api/diagram
     Body: { name, content }
     Creates new diagram, validates syntax
     Returns: { id }

POST /api/diagram/:id
     Body: { content }
     Validates syntax, blocks save if invalid
     Returns: { success, error? }

DELETE /api/diagram/:id
     Removes .mmd file
     Returns: { success }

GET  /api/render/:id?theme=default&format=svg
     Returns: Rendered diagram (SVG or PNG)

GET  /api/thumbnail/:id
     Returns: Small PNG for dashboard (200x150, cached)
```

## WebSocket Protocol

Clients connect to `ws://host:3737/ws`. The connection stays open for live updates.

**Server to client:**
```javascript
{ type: 'connected', diagramCount }
{ type: 'diagram_updated', id, content, lastModified }
{ type: 'diagram_created', id, name }
{ type: 'diagram_deleted', id }
```

**Client to server:**
```javascript
{ type: 'subscribe', id }      // Watch specific diagram
{ type: 'unsubscribe', id }    // Stop watching
```

## Frontend Details

### Dashboard (index.html)

- Grid layout: 4 columns desktop, responsive
- Each card shows thumbnail, name, last modified time
- Search box filters by filename (client-side)
- Click card opens `/diagram.html?id=<filename>`
- Connection status indicator in top-right: green (connected), yellow (connecting), red (disconnected with reconnect button)
- WebSocket updates grid when files change

### Editor (diagram.html)

**Layout:**
- Split panes: left editor (textarea), right preview (SVG + panzoom)
- Resizable divider between panes
- Top toolbar: diagram name, theme dropdown, undo/redo buttons, export buttons (SVG/PNG/Copy), connection status

**Editing behavior:**
- Auto-saves after 500ms of inactivity
- Validates before save, shows error banner if invalid, blocks save
- Maintains undo history in memory (max 50 entries)
- WebSocket subscribes to current diagram, updates if external changes occur

**Connection management:**
- Auto-reconnect with exponential backoff: 1s, 2s, 4s, 8s, max 30s
- Manual reconnect: click status indicator when disconnected
- Status shows in toolbar constantly

## Backend Services

### DiagramManager

Manages all diagram operations and maintains the source of truth.

**Startup:**
- Scans diagrams folder
- Builds index: `Map<id, { name, path, lastModified }>`
- Diagram ID = filename without .mmd extension

**Operations:**
- `listDiagrams()`: Returns indexed diagrams
- `getDiagram(id)`: Reads .mmd file from disk
- `saveDiagram(id, content)`: Validates first, rejects if invalid, then writes
- `deleteDiagram(id)`: Removes file and index entry
- `createDiagram(name, content)`: Validates, sanitizes filename, creates .mmd file

### Validator

Uses mermaid library to parse syntax.

- `validate(content)`: Returns `{ valid, error?, line? }`
- Catches parse errors, formats for UI display

### Renderer

Generates visual outputs using mermaid library.

- `renderSVG(content, theme)`: Returns SVG string
- `renderPNG(content, theme, width)`: Converts SVG to PNG buffer
- `generateThumbnail(content)`: Creates 200x150 PNG, caches in `Map<id, Buffer>` (max 100 entries)
- Supports themes: default, dark, forest, neutral

### FileWatcher

Monitors diagram folder for external changes.

- Uses `fs.watch()` or chokidar
- Debounces events (100ms) to avoid duplicate triggers
- On change: updates DiagramManager index, broadcasts via WebSocket
- Handles create, modify, delete events

## MCP Integration

Each Claude Code instance runs its own MCP server via stdio. The MCP server checks if the web server runs and starts it if needed.

### Startup Logic

```typescript
async function ensureWebServerRunning() {
  try {
    await fetch('http://localhost:3737/api/diagrams');
    // Server running
  } catch (error) {
    // Start web server as background process
    Bun.spawn(['bun', 'run', 'src/server.ts'], {
      detached: true,
      stdio: 'ignore'
    });
    await sleep(2000);  // Wait for startup
  }
}
```

### MCP Tools

All tools wrap HTTP calls to the web server.

```
list_diagrams()
  → GET /api/diagrams
  → Returns: [{ id, name, lastModified }]

get_diagram(id: string)
  → GET /api/diagram/:id
  → Returns: { id, name, content }

create_diagram(name: string, content: string)
  → POST /api/diagram
  → Returns: { id, url: "http://0.0.0.0:3737/diagram.html?id=<id>" }

update_diagram(id: string, content: string)
  → POST /api/diagram/:id
  → Returns: { success, error? }

validate_diagram(content: string)
  → POST /api/validate
  → Returns: { valid, error?, line? }

preview_diagram(id: string)
  → Returns: {
      url: "http://0.0.0.0:3737/diagram.html?id=<id>",
      message: "Open this URL in your browser"
    }
```

## Error Handling

### File System

- Missing diagrams folder: Create on startup
- Permission errors: Return 500 with clear message
- Invalid filenames: Skip during scan, log warning
- Concurrent writes: Last write wins (no locking needed for trusted team)

### Validation

- Invalid syntax: Return 400 with error message and line number
- Empty content: Allow (valid for new diagrams)
- Large files (>1MB): Reject with 413 "Diagram too large"

### WebSocket

- Client disconnects: Remove from subscribers, clean up
- Server restarts: Clients auto-reconnect, reload state
- Network partition: Exponential backoff prevents spam
- Multiple tabs on same diagram: All receive updates, last edit wins

### Rendering

- Rendering fails: Return placeholder SVG with error text
- Thumbnail fails: Return default "no preview" image
- Unknown theme: Fall back to "default"

### MCP

- Missing diagram ID: Return error with valid ID list
- Invalid characters in name: Sanitize to alphanumeric, hyphens, underscores
- Simultaneous MCP and browser edits: FileWatcher broadcasts latest to all clients

## Configuration

```typescript
PORT: 3737
HOST: "0.0.0.0"              // Bind to all interfaces for LAN
DIAGRAMS_FOLDER: "./diagrams"
MAX_FILE_SIZE: 1048576       // 1MB
THUMBNAIL_CACHE_SIZE: 100    // Max thumbnails in memory
UNDO_HISTORY_SIZE: 50        // Max undo steps per diagram
WS_RECONNECT_MAX_DELAY: 30000 // 30 seconds
```

## Dependencies

```json
{
  "dependencies": {
    "mermaid": "^10.x",
    "@modelcontextprotocol/sdk": "latest",
    "chokidar": "^3.x"
  },
  "devDependencies": {
    "bun-types": "latest"
  }
}
```

Frontend uses panzoom.js via CDN.

## Running the Server

```bash
# Development (web server only)
bun run src/server.ts

# Production with custom diagram folder
DIAGRAMS_FOLDER=/path/to/diagrams bun run src/server.ts

# MCP server (Claude Code connects via stdio)
bun run src/mcp/server.ts
```

### Startup Sequence

1. Load configuration
2. Create diagrams folder if missing
3. Initialize DiagramManager (scan and index)
4. Start FileWatcher
5. Start HTTP server on 0.0.0.0:3737
6. Log ready message with access URLs

### Network Access

Access from any LAN device: `http://<server-ip>:3737`

No authentication required (trusted team environment).

## Workflow

**Typical usage:**
1. Team member starts web server (or first Claude starts it)
2. Developers open dashboard in browser
3. Click diagram to edit in split-pane view
4. Changes save automatically, broadcast to all viewers
5. Claude creates/updates diagrams via MCP tools
6. Final diagrams get moved to project folders manually

**Multi-Claude scenario:**
1. First Claude runs MCP command, starts web server
2. Subsequent Claude instances detect running server, connect to it
3. All Claude instances share same diagram state
4. Web server continues running after any Claude disconnects
