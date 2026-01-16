# Mermaid Collaboration Server

A real-time Mermaid diagram collaboration server with integrated Model Context Protocol (MCP) support for Claude Code.

## Features

- **Web Dashboard**: Browse diagrams with cached thumbnails, search, and filter by type or folder
- **Folder Organization**: Organize diagrams and documents into folders with visual folder cards
- **Item Locking**: Lock items to prevent accidental deletion
- **Import Support**: Import diagrams from files (.mmd, .md, .txt, .yaml) or paste text directly
- **Split-Pane Editor**: Live preview with syntax validation, undo/redo, draggable pane separators
- **Real-Time Collaboration**: WebSocket-based live updates across all connected clients
- **File-Based Storage**: Simple `.mmd` files for version control and external editing
- **Syntax Validation**: Block invalid saves with line-specific error reporting
- **MCP Integration**: Claude Code can create, read, update, and preview diagrams
- **Export**: Download diagrams as SVG or PNG
- **Pan & Zoom**: Interactive diagram preview with fit controls
- **Direction Toggle**: Switch between horizontal (LR) and vertical (TD) layouts
- **Wireframe Plugin**: Built-in support for UI wireframes and mockups
- **SMACH Transpiler**: Convert ROS SMACH state machine YAML to interactive flowcharts
- **Interactive Editing**: Click nodes, edges, and containers to edit via properties pane
- **Document Collaboration**: Create and edit markdown documents alongside diagrams
- **LAN Accessible**: Share with team members on local network

## Wireframe Plugin

This project includes a custom Mermaid plugin for creating UI wireframes with text-based syntax. The plugin supports mobile, tablet, and desktop viewports with layouts in both horizontal (LR) and vertical (TD) directions.

### Quick Example

```
wireframe mobile TD
  screen "Login Screen"
    col padding=16
      Title "Welcome Back"
      Input "Email"
      Input "Password"
      Button "Sign In" primary
```

### Features

- **Multiple Viewports**: mobile (375px), tablet (768px), desktop (1200px)
- **Layout Directions**: Horizontal (LR) or Vertical (TD)
- **UI Components**: Buttons, inputs, text, titles, cards, grids, lists, navigation
- **Flex Layouts**: Rows and columns with flexible sizing
- **Modifiers**: Width, height, padding, alignment, variants (primary, danger, success)

### Available Widgets

- **Containers**: `screen`, `col`, `row`, `Card`
- **Input Controls**: `Button`, `Input`, `Checkbox`, `Radio`, `Switch`, `Dropdown`
- **Display**: `Text`, `Title`, `Icon`, `Image`, `Avatar`
- **Navigation**: `AppBar`, `NavMenu`, `BottomNav`, `FAB`
- **Structure**: `Grid`, `List`, `divider`, `spacer`

### Plugin Development

The wireframe plugin source is located in `plugins/wireframe/`:

```bash
# Build the plugin
npm run build:wireframe

# Watch for changes during development
npm run build:wireframe:watch

# Run plugin tests
npm run test:wireframe
```

The built plugin is automatically copied to `public/js/plugins/mermaid-wireframe.js` and loaded by the editor.

For detailed plugin documentation, see [plugins/wireframe/README.md](plugins/wireframe/README.md).

## SMACH State Machine Transpiler

The editor automatically detects ROS SMACH state machine YAML files and transpiles them to interactive Mermaid flowcharts. This allows visualization and editing of complex robotics state machines.

### Quick Example

```yaml
smach_diagram:
  MyStateMachine:
    type: StateMachine
    outcomes: [succeeded, aborted]
    initial_state: Initialize
    states:
      Initialize:
        type: CallbackState
        transitions:
          succeeded: ProcessData
          failed: aborted
      ProcessData:
        type: SimpleActionState
        transitions:
          succeeded: succeeded
          aborted: aborted
```

### Supported State Types

| State Type | Shape | Description |
|------------|-------|-------------|
| StateMachine, Concurrence | Subgraph | Container states with child states |
| SimpleActionState, ServoActionState | Stadium | Action states (ROS actions) |
| MonitorState, SimpleServiceState | Hexagon | Monitor/service states |
| CallbackState, DelayState | Rounded | Utility states |
| ConditionState | Diamond | Decision/condition states |
| ExecuteSupplementalState, JoinState | Parallelogram | Background execution |
| FactoryState, BehaviorTreeState | Trapezoid | Advanced states |

### Interactive Editing

When viewing a SMACH diagram, click on any state or container to:
- View state properties in the right pane
- Edit state name
- Add/modify transitions
- Delete states

Transitions can be edited inline with buttons for:
- **E** - Edit outcome name
- **→** - Change target to existing state
- **+** - Change target to new state
- **×** - Delete transition

## Document Collaboration

In addition to diagrams, the server supports markdown documents for design specs, notes, and documentation.

### MCP Tools for Documents

- `list_documents()` - List all documents with metadata
- `get_document(id)` - Read document content
- `create_document(name, content)` - Create new document
- `update_document(id, content)` - Update existing document
- `preview_document(id)` - Get browser URL for document

### Document Storage

Documents are stored as `.md` files in the `documents/` folder and support:
- Real-time collaboration via WebSocket
- Markdown preview with syntax highlighting
- Version control friendly plain text format

## Folder Organization

The dashboard supports organizing diagrams and documents into folders for better project management.

### Features

- **Folder Cards**: Folders appear at the top of the dashboard grid, showing item count and last updated date
- **Navigation**: Click a folder to view its contents; use the parent card to navigate back to root
- **Move Items**: Use the arrow button on any item card to move it to a different folder or create a new one
- **Locking**: Click the lock icon on any item to prevent accidental deletion
- **Delete All**: Respects folder scope (only deletes items in current view) and skips locked items

### Import

Use the **+** button in the header to:
- **New Folder**: Create a new folder
- **Import File**: Upload `.mmd`, `.md`, `.txt`, or `.yaml` files (auto-detects type)
- **Import Text**: Paste content directly and auto-detect whether it's a diagram or document
- **Manage Folders**: Rename or delete existing folders

### Metadata Storage

Folder assignments and lock states are stored in `metadata.json` at the project root. The actual files remain flat in `diagrams/` and `documents/` folders for easy version control.

### Thumbnail Caching

The dashboard renders diagram thumbnails client-side using Mermaid.js, with localStorage caching for performance:
- Thumbnails are cached based on content hash, so they update when diagrams change
- All diagram types are supported: flowcharts, sequence diagrams, wireframes, SMACH state machines
- Cached thumbnails load instantly on repeat visits

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
- View all diagrams and documents as thumbnail cards
- Filter by folder or type (Diagrams, SMACH, Documents)
- Search by name
- Folder cards at top for navigation
- Lock/move items via card buttons
- Import from file or text via + menu
- Connection status indicator (top-right)

**Diagram Editor** (`http://localhost:3737/diagram.html?id=<diagram-id>`)
- Three-pane layout: code editor, diagram preview, properties pane
- Draggable dividers to resize panes
- Auto-save with 500ms debounce
- Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
- Click nodes/edges/containers to view and edit properties
- Theme switcher (default, dark, forest, neutral)
- Export SVG/PNG
- Pan and zoom preview
- SMACH YAML auto-detection and transpilation

**Document Editor** (`http://localhost:3737/document.html?id=<document-id>`)
- Split-pane: markdown editor and live preview
- Real-time collaboration via WebSocket
- Auto-save with debounce

### MCP Tools (via Claude Code)

Claude Code can manage diagrams and documents through MCP tools:

**Diagram Tools:**
- `list_diagrams()` - List all diagrams with metadata
- `get_diagram(id)` - Read diagram content
- `create_diagram(name, content)` - Create new diagram (validates first)
- `update_diagram(id, content)` - Update existing diagram (validates first)
- `validate_diagram(content)` - Check Mermaid syntax without saving
- `preview_diagram(id)` - Get browser URL for diagram

**Document Tools:**
- `list_documents()` - List all documents with metadata
- `get_document(id)` - Read document content
- `create_document(name, content)` - Create new document
- `update_document(id, content)` - Update existing document
- `preview_document(id)` - Get browser URL for document

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

- **DiagramManager**: Diagram CRUD operations with in-memory indexing
- **DocumentManager**: Document CRUD operations for markdown files
- **MetadataManager**: Folder and lock state management
- **SmachTranspiler**: Converts SMACH YAML to Mermaid flowcharts
- **Validator**: Mermaid syntax validation via `mermaid.parse()`
- **Renderer**: Server-side SVG generation with jsdom
- **FileWatcher**: Monitors `.mmd` and `.md` files with chokidar
- **WebSocketHandler**: Real-time update broadcasting

### File Structure

```
.
├── src/
│   ├── config.ts              # Configuration
│   ├── types.ts               # TypeScript interfaces
│   ├── server.ts              # Main web server
│   ├── services/
│   │   ├── diagram-manager.ts  # Diagram CRUD operations
│   │   ├── document-manager.ts # Document CRUD operations
│   │   ├── metadata-manager.ts # Folder and lock state management
│   │   ├── validator.ts        # Syntax validation
│   │   ├── renderer.ts         # SVG rendering
│   │   ├── file-watcher.ts     # File monitoring
│   │   ├── smach-transpiler.ts # SMACH YAML to Mermaid transpiler
│   │   └── dom-setup.ts        # jsdom polyfill
│   ├── websocket/
│   │   └── handler.ts         # WebSocket management
│   ├── routes/
│   │   └── api.ts             # REST API endpoints
│   └── mcp/
│       └── server.ts          # MCP server
├── plugins/
│   └── wireframe/             # Wireframe plugin source
│       ├── src/               # Plugin source code
│       ├── tests/             # Plugin tests
│       ├── package.json       # Plugin dependencies
│       └── rollup.config.js   # Build configuration
├── public/
│   ├── index.html             # Dashboard
│   ├── diagram.html           # Diagram editor
│   ├── document.html          # Document editor
│   ├── css/
│   │   └── styles.css         # Global styles
│   └── js/
│       ├── api-client.js      # HTTP & WebSocket client
│       ├── dashboard.js       # Dashboard logic
│       ├── editor.js          # Diagram editor logic
│       ├── smach-transpiler.js # Client-side SMACH transpiler
│       └── plugins/
│           └── mermaid-wireframe.js  # Built wireframe plugin
├── diagrams/                  # Diagram storage (.mmd files)
└── documents/                 # Document storage (.md files)
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
